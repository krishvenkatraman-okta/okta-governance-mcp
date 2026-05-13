"""
ASGI application factory for production deployment.
Exports a module-level 'app' instance that can be run directly with uvicorn.

Usage:
    uvicorn okta_agent_proxy.app:app --host 0.0.0.0 --port 8000 --proxy-headers
"""
import os
import logging
import base64
import secrets
import httpx
from typing import Optional
from urllib.parse import urlencode
from contextlib import asynccontextmanager
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.responses import JSONResponse
from starlette.requests import Request
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from okta_agent_proxy.middleware.correlation import CorrelationIdMiddleware
from okta_agent_proxy.audit import (
    init_audit_emitter, shutdown_audit_emitter, emit_audit_event,
    AuditEventType, AuditSeverity,
)
from okta_agent_proxy.config import load_config
from okta_agent_proxy.routing import ResourceRouter
from okta_agent_proxy.middleware import setup_logging
from okta_agent_proxy.auth.okta_validator import OktaTokenValidator
from okta_agent_proxy.proxy import ProxyHandler
from okta_agent_proxy.database import get_config_store
from okta_agent_proxy.admin import routes as admin_routes
from okta_agent_proxy.mcp.unified_handler import UnifiedMCPHandler
from okta_agent_proxy.cache.cache_service import CacheService
from okta_agent_proxy.cache.pubsub import (
    CacheEventBus,
    CHANNEL_ROUTE_INVALIDATE,
    CHANNEL_AGENT_INVALIDATE,
    CHANNEL_TOOL_CATALOG_INVALIDATE,
)
from okta_agent_proxy.auth.cimd_fetcher import CIMDFetcher, CIMDMetadata
from okta_agent_proxy.auth.cimd_policy import CIMDTrustPolicy
from okta_agent_proxy.auth.confidential_relay import ConfidentialRelay, RelayError
from okta_agent_proxy.auth.client_registry import ClientRegistry
from okta_agent_proxy.auth.dcr_policy import DCRPolicy
from okta_agent_proxy.auth.dcr_handler import DCRHandler
from okta_agent_proxy.auth.consent_transaction import ConsentTransactionStore
from okta_agent_proxy.auth.consent_verification import ConsentVerificationService
from okta_agent_proxy.admin import dcr_routes
from okta_agent_proxy.admin import okta_import_routes
from okta_agent_proxy.admin import okta_event_hook
from okta_agent_proxy.admin import credential_routes
from okta_agent_proxy.auth.adapter_cimd import AdapterCIMDServer
from okta_agent_proxy.auth.ai_agent_promoter import AIAgentPromoter
from okta_agent_proxy.auth.managed_connections import ManagedConnectionsSync
from okta_agent_proxy.auth.okta_service_auth import OktaServiceAuth
from okta_agent_proxy.storage.postgres import ResourceStore
from okta_agent_proxy.resources.event_bus import (
    CacheEventBus as ResourceMapEventBus,
    CHANNEL_RESOURCE_CHANGED as RM_CHANNEL_RESOURCE_CHANGED,
)
from okta_agent_proxy.resources.syncer import OktaConnectionSyncer
# LocalResourceMapSyncer is no longer used — OktaConnectionSyncer handles
# both service-token and UI-triggered sync modes, discovering agent IDs
# from the database.

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

# Load configuration
config = load_config()

# Initialize cache service first (shared across all components including config store)
cache_service = CacheService.create_from_env()
logger.info(f"Cache service initialized: L2={type(cache_service.l2).__name__}")

# Try to get encryption service for token/config cache encryption
try:
    from okta_agent_proxy.crypto.encryption import get_encryption_service
    _encryption_svc = get_encryption_service()
except Exception:
    logger.warning("Encryption service not available — cached tokens will be stored unencrypted")
    _encryption_svc = None

# Initialize PostgreSQL configuration store (with config caching)
logger.info("Initializing PostgreSQL configuration store")

try:
    store = get_config_store(cache_service=cache_service)

    # Log configuration stats
    resources_count = len(store.get_all_resources())
    agents_count = len(store.get_all_agents(enabled_only=False))

    logger.info(f"✓ Configuration store initialized")
    logger.info(f"  - Resources: {resources_count}")
    logger.info(f"  - Agents: {agents_count}")

    database_url = os.getenv("DATABASE_URL", "")
    # Mask password in log
    masked_url = database_url
    if "@" in masked_url:
        parts = masked_url.split("@")
        if ":" in parts[0]:
            user_part = parts[0].rsplit(":", 1)[0]
            masked_url = f"{user_part}:***@{parts[1]}"
    logger.info(f"  - Database: {masked_url}")
    logger.info(f"  - Encryption: AES-256-GCM")

except Exception as e:
    logger.error(f"Failed to initialize configuration store: {e}")
    logger.error("Check that:")
    logger.error("  - DATABASE_URL is set correctly")
    logger.error("  - PostgreSQL is running and accessible")
    logger.error("  - ENCRYPTION_KEY or ENCRYPTION_PASSWORD is set")
    logger.error("  - Database migrations have been run (alembic upgrade head)")
    raise

# ============================================================================
# Credential Automation Service
# ============================================================================
try:
    from okta_agent_proxy.okta_admin.client import OktaAPIClient
    from okta_agent_proxy.okta_admin.service import CredentialAutomationService

    _okta_api_client = OktaAPIClient()
    _credential_service = CredentialAutomationService(
        api_client=_okta_api_client,
        config_store=store,
    )
    credential_routes.wire_credential_routes(_credential_service)
    logger.info("Credential automation endpoints registered")
except Exception as e:
    logger.warning(f"Credential automation not available: {e}")

# ============================================================================
# Resource Map: Okta-native resource architecture
# ============================================================================
# ResourceStore provides the L1 in-memory cache over the resource_map table.
# On first deploy the table is empty — admin adds entries via UI, API, or
# the Okta Import unresolved connections flow.
_resource_store: ResourceStore | None = None
_rm_event_bus: ResourceMapEventBus | None = None
_rm_syncer = None  # OktaConnectionSyncer

try:
    from okta_agent_proxy.database import get_engine
    from sqlalchemy.orm import sessionmaker as _sa_sessionmaker

    _rm_session_factory = _sa_sessionmaker(bind=get_engine())
    _resource_store = ResourceStore(_rm_session_factory)
    _rm_count = _resource_store.load_cache()
    logger.info(f"Resource Map: {_rm_count} entries loaded into L1 cache")

    # CacheEventBus for cross-pod invalidation (Redis when available, poll fallback)
    _redis_url = os.getenv("REDIS_URL") if os.getenv("CACHE_PROVIDER", "").lower() == "redis" else None
    _rm_event_bus = ResourceMapEventBus(
        redis_url=_redis_url,
        poll_interval_resource=config.gateway.cache_poll_interval_seconds,
        poll_interval_okta=config.gateway.okta_sync_interval_seconds,
    )

    # Create syncer: OktaConnectionSyncer discovers agent IDs from the database
    # (each imported agent has its own okta_ai_agent_id).
    # OKTA_SERVICE_TOKEN is optional — only needed for background auto-sync.
    # UI-triggered sync uses the admin's Okta token instead.
    _okta_service_token = config.gateway.okta_service_token or os.getenv("OKTA_SERVICE_TOKEN", "")

    _rm_syncer = OktaConnectionSyncer(
        okta_domain=config.gateway.okta_domain,
        api_token=_okta_service_token,  # may be empty — UI-triggered sync uses admin token
        resource_map_store=_resource_store,
        event_bus=_rm_event_bus,
        stale_threshold=config.gateway.okta_sync_stale_threshold,
    )
    if _okta_service_token:
        logger.info(
            "Resource Map: OktaConnectionSyncer configured "
            f"(service_token=set, sync_interval={config.gateway.okta_sync_interval_seconds}s)"
        )
    else:
        logger.info(
            "Resource Map: OktaConnectionSyncer configured "
            "(no service token — UI-triggered sync only)"
        )

except Exception as e:
    logger.warning(f"Resource Map initialization skipped: {e}")
    _resource_store = None
    _rm_event_bus = None
    _rm_syncer = None

# Initialize core services
validator = OktaTokenValidator(store, cache_service=cache_service)
router = ResourceRouter(
    config.resources,
    store=store,
    cache_service=cache_service,
    encryption_service=_encryption_svc,
    syncer=_rm_syncer,
)
proxy_handler = ProxyHandler(
    router, validator, store,
    http_timeout=30.0, session_ttl=3600, cache_service=cache_service,
)

# Initialize AI Agent Promoter (Okta for AI Agents EA integration)
# Must be created before ClientRegistry and DCRHandler which depend on it
_promoter_service_auth = OktaServiceAuth()
ai_agent_promoter = AIAgentPromoter(store=store, service_auth=_promoter_service_auth)

# Initialize CIMD components for URL-based client_id support
cimd_fetcher = CIMDFetcher(cache_service=cache_service)
cimd_policy = CIMDTrustPolicy()
confidential_relay = ConfidentialRelay()
client_registry = ClientRegistry(store, cimd_fetcher, cimd_policy,
                                ai_agent_promoter=ai_agent_promoter,
                                cache_service=cache_service)

# Wire CIMD relay + client registry into proxy handler for path-based CIMD auth
proxy_handler._relay = confidential_relay
proxy_handler._client_registry = client_registry

# Initialize STS consent interstitial components
consent_store = ConsentTransactionStore()
consent_service = ConsentVerificationService(router, router.resource_token_cache)

unified_handler = UnifiedMCPHandler(
    router, validator, store, http_timeout=30.0, cache_service=cache_service,
    relay=confidential_relay,
    client_registry=client_registry,
)

# Initialize pub/sub event bus for cross-container invalidation
event_bus = CacheEventBus(cache_service)

# Initialize DCR components
dcr_policy = DCRPolicy(store=store, event_bus=event_bus)

dcr_handler = DCRHandler(
    dcr_policy=dcr_policy,
    store=store,
    encryption_service=_encryption_svc,
    event_bus=event_bus,
    ai_agent_promoter=ai_agent_promoter,
)

# Initialize Managed Connections sync
managed_connections_sync = ManagedConnectionsSync(store=store, cache_service=cache_service)


def get_router() -> ResourceRouter:
    """Get the global ResourceRouter instance (used by admin routes for dynamic registration)."""
    return router


def get_event_bus() -> CacheEventBus:
    """Get the global CacheEventBus instance (used by admin routes for publishing)."""
    return event_bus


def get_dcr_handler() -> DCRHandler:
    """Get the global DCRHandler instance (used by admin DCR routes)."""
    return dcr_handler


def get_dcr_policy():
    """Get the global DCRPolicy instance (used by admin DCR routes)."""
    return dcr_policy


def get_resource_store():
    """Get the global ResourceStore instance (used by admin routes for CRUD)."""
    return _resource_store


# Backward-compat alias
get_resource_map_store = get_resource_store


def get_resource_map_event_bus():
    """Get the Resource Map CacheEventBus (used by admin routes for invalidation)."""
    return _rm_event_bus


def get_resource_syncer():
    """Get the active syncer (OktaConnectionSyncer)."""
    return _rm_syncer


# Backward-compat alias
get_resource_map_syncer = get_resource_syncer


# ---------------------------------------------------------------------------
# DCR selection session helpers (cross-instance via CacheService L2)
# ---------------------------------------------------------------------------
_DCR_SELECT_TTL = 300  # 5 minutes
_DCR_SELECT_PREFIX = "dcr_select:"


async def _store_dcr_selection_session(selection_state: str, session_data: dict) -> None:
    """Store a DCR selection session in the shared cache (L2 for cross-instance)."""
    import json as _json
    await cache_service.set(
        f"{_DCR_SELECT_PREFIX}{selection_state}",
        _json.dumps(session_data),
        ttl_seconds=_DCR_SELECT_TTL,
    )


async def _get_dcr_selection_session(selection_state: str) -> Optional[dict]:
    """Retrieve a DCR selection session from the shared cache."""
    import json as _json
    raw = await cache_service.get(f"{_DCR_SELECT_PREFIX}{selection_state}")
    if raw is None:
        return None
    try:
        return _json.loads(raw)
    except Exception:
        return None


async def _consume_dcr_selection_session(selection_state: str) -> Optional[dict]:
    """Retrieve and delete a DCR selection session (one-time use)."""
    session = await _get_dcr_selection_session(selection_state)
    if session is not None:
        await cache_service.delete(f"{_DCR_SELECT_PREFIX}{selection_state}")
    return session


# Initialize Adapter CIMD server (hosts the adapter's own client metadata + JWKS)
adapter_cimd = AdapterCIMDServer()


async def adapter_client_metadata(request: Request):
    """GET /oauth/client-metadata.json — Adapter CIMD document."""
    return JSONResponse(adapter_cimd.get_client_metadata())


async def adapter_jwks(request: Request):
    """GET /oauth/jwks.json — Adapter public JWKS."""
    return JSONResponse(adapter_cimd.get_jwks())


async def adapter_resource_callback(request: Request):
    """GET /oauth/backend-callback — Placeholder for outbound OAuth callback (P7)."""
    return JSONResponse(
        {"error": "not_implemented", "message": "Resource OAuth callback not yet implemented"},
        status_code=501,
    )




# OAuth discovery endpoint handlers
async def oauth_protected_resource(request: Request):
    """Serve /.well-known/oauth-protected-resource as HTTP endpoint"""
    # Get Okta issuer (the actual authorization server that issues tokens)
    okta_issuer = os.getenv("OKTA_ISSUER")
    if not okta_issuer:
        okta_issuer = f"https://{config.gateway.okta_domain}"

    gateway_base_url = os.getenv("GATEWAY_BASE_URL", "http://localhost:8000")
    metadata = {
        "resource": gateway_base_url,
        "authorization_servers": [gateway_base_url],
        "scopes_supported": ["openid", "offline_access"],
        "bearer_methods_supported": ["header"],
        "resource_documentation": f"{gateway_base_url}/docs",
    }
    return JSONResponse(metadata)


async def oauth_protected_resource_by_name(request: Request):
    """Serve resource-specific /.well-known/oauth-protected-resource/{resource}"""
    # Extract path from URL (e.g., "hr" from /.well-known/oauth-protected-resource/hr)
    path_segment = request.path_params.get("resource")
    request_path = f"/{path_segment}"

    # Point authorization_servers at the gateway (BFF pattern).
    # The gateway's /.well-known/oauth-authorization-server serves
    # the BFF discovery document that routes clients through the
    # gateway's /oauth/authorize endpoint.
    gateway_base = config.gateway.gateway_base_url.rstrip("/")

    # Base metadata
    metadata = {
        "authorization_servers": [gateway_base],
        "scopes_supported": ["openid", "offline_access"],
        "bearer_methods_supported": ["header"]
    }

    # Use router to resolve path to resource name.
    # The router reads from the resources table (via OktaConnectionSyncer),
    # so a successful resolution confirms the resource exists.
    try:
        resource_name = router.get_resource_for_path(request_path)
        if not resource_name:
            return JSONResponse({
                "error": "invalid_resource",
                "error_description": f"No resource found for path '{request_path}'"
            }, status_code=404)

        # resource MUST be a URL per RFC 8707 / RFC 9728
        metadata["resource"] = f"{gateway_base}{request_path}"
        metadata["resource_documentation"] = f"{gateway_base}{request_path}"
    except Exception as e:
        logger.error(f"Error fetching resource for path {request_path}: {e}")
        return JSONResponse({
            "error": "server_error",
            "error_description": "Failed to retrieve resource metadata"
        }, status_code=500)

    return JSONResponse(metadata)


async def oauth_authorization_server(request: Request):
    """Serve modified /.well-known/oauth-authorization-server (BFF pattern)"""
    # Return gateway's token endpoint but Okta's authorization endpoint
    # This implements the BFF (Backend-for-Frontend) pattern where:
    # - Users authenticate directly with Okta (authorization_endpoint)
    # - Token exchange goes through gateway (token_endpoint) for interception

    # Use the org auth server for client-facing BFF metadata.
    # The relay app authenticates users against the org auth server,
    # so the discovery document must match.
    relay_auth_server_id = os.getenv("RELAY_OKTA_AUTH_SERVER_ID", "org")
    okta_domain = config.gateway.okta_domain
    if relay_auth_server_id.lower() == "org":
        okta_issuer = f"https://{okta_domain}"
        jwks_uri = f"https://{okta_domain}/oauth2/v1/keys"
    else:
        okta_issuer = f"https://{okta_domain}/oauth2/{relay_auth_server_id}"
        jwks_uri = f"{okta_issuer}/v1/keys"

    scopes = ["openid", "offline_access"]
    gateway_base = config.gateway.gateway_base_url

    metadata = {
        "issuer": okta_issuer,
        "authorization_endpoint": f"{gateway_base}/oauth/authorize",
        "token_endpoint": f"{gateway_base}/oauth2/v1/token",
        "registration_endpoint": f"{gateway_base}/.well-known/oauth/registration",
        "jwks_uri": jwks_uri,
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post", "private_key_jwt"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": scopes,
        "client_id_metadata_document_supported": True,
    }
    return JSONResponse(metadata)


async def oauth_authorization_server_by_name(request: Request):
    """Serve resource-specific /.well-known/oauth-authorization-server/{resource}"""
    # Extract path from URL (e.g., "hr" from /.well-known/oauth-authorization-server/hr)
    path_segment = request.path_params.get("resource")
    request_path = f"/{path_segment}"

    # Get Okta issuer from environment or construct from domain
    okta_issuer = os.getenv("OKTA_ISSUER")
    if not okta_issuer:
        okta_issuer = f"https://{config.gateway.okta_domain}"

    # Add scopes directly to authorization endpoint as workaround for clients
    # that don't read scopes_supported from discovery document
    scopes = ["openid", "offline_access"]
    scope_param = urlencode({"scope": " ".join(scopes)})
    authorization_endpoint = f"{okta_issuer}/v1/authorize?{scope_param}"

    metadata = {
        "issuer": okta_issuer,
        "authorization_endpoint": authorization_endpoint,
        "token_endpoint": f"{config.gateway.gateway_base_url}/oauth2/v1/token",  # BFF intercepts token exchange
        "registration_endpoint": f"{config.gateway.gateway_base_url}/.well-known/oauth/registration",
        "jwks_uri": f"{okta_issuer}/v1/keys",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "private_key_jwt"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["openid", "offline_access"],
    }

    # Use router to resolve path to resource name and add resource-specific information
    try:
        resource_name = router.get_resource_for_path(request_path)
        if resource_name:
            metadata["resource_name"] = resource_name
            # Try to get the resource URL from the resolved resource
            try:
                resolved = router.resolve_resource(resource_name)
                if resolved and hasattr(resolved, "url"):
                    metadata["resource_url"] = resolved.url
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"Resource not found for path {request_path} in metadata request: {e}")

    return JSONResponse(metadata)


async def oauth_registration(request: Request):
    """Serve /.well-known/oauth/registration (RFC 7591)"""
    if request.method == "GET":
        return JSONResponse({
            "registration_endpoint": f"{config.gateway.gateway_base_url}/.well-known/oauth/registration"
        })

    # POST: Dynamic Client Registration
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "Invalid JSON body"},
            status_code=400,
        )

    source_ip = request.client.host if request.client else "unknown"

    # Extract optional Bearer token
    bearer_token = None
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        bearer_token = auth_header[7:]

    status_code, response_body = await dcr_handler.handle_registration(
        body, source_ip, bearer_token
    )
    return JSONResponse(response_body, status_code=status_code)


def _get_okta_token_url() -> str:
    """Build the Okta token endpoint URL matching the relay's auth server.

    The relay obtains auth codes from the org (or relay-configured) auth server,
    so the token exchange must go to the same server's token endpoint.
    """
    okta_domain = config.gateway.okta_domain
    relay_auth_server_id = os.getenv("RELAY_OKTA_AUTH_SERVER_ID", "org")
    if relay_auth_server_id.lower() == "org":
        return f"https://{okta_domain}/oauth2/v1/token"
    return f"https://{okta_domain}/oauth2/{relay_auth_server_id}/v1/token"


def _extract_client_credentials(request: Request, body: dict) -> tuple:
    """
    Extract client_id and client_secret from the request.

    Supports two methods:
    1. client_secret_basic: Authorization: Basic base64(client_id:client_secret)
    2. client_secret_post: client_id and client_secret in the POST body

    Returns (client_id, client_secret, error_response) where error_response is
    a JSONResponse if extraction failed, or None on success.
    """
    client_id = None
    client_secret = None

    # Try Authorization: Basic header first
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("basic "):
        try:
            encoded = auth_header[6:]  # Strip "Basic "
            decoded = base64.b64decode(encoded).decode("utf-8")
            if ":" not in decoded:
                return None, None, JSONResponse(
                    {"error": "invalid_request", "error_description": "Malformed Authorization header"},
                    status_code=400,
                )
            client_id, client_secret = decoded.split(":", 1)
        except Exception:
            return None, None, JSONResponse(
                {"error": "invalid_request", "error_description": "Malformed Authorization header"},
                status_code=400,
            )

    # Fall back to POST body
    if not client_id:
        client_id = body.get("client_id")
        client_secret = body.get("client_secret")

    if not client_id:
        return None, None, JSONResponse(
            {"error": "invalid_request", "error_description": "client_id is required"},
            status_code=400,
        )

    return client_id, client_secret, None


async def oauth_token_endpoint(request: Request):
    """
    Backend-for-Frontend (BFF) token endpoint proxy.

    Proxies authorization_code and refresh_token grant types to Okta's
    real token endpoint. Supports client_secret_basic and client_secret_post
    authentication methods.
    """
    # Parse form-encoded body (standard for token endpoints)
    try:
        content_type = request.headers.get("content-type", "")
        if content_type.startswith("application/x-www-form-urlencoded"):
            body = dict(await request.form())
        else:
            body = await request.json()
    except Exception:
        body = dict(request.query_params)

    grant_type = body.get("grant_type")

    # Check for CIMD client_id (URL-based) before standard credential extraction
    cimd_client_id = body.get("client_id", "")
    if cimd_client_id and ClientRegistry._is_cimd_url(cimd_client_id):
        if grant_type == "authorization_code":
            code = body.get("code")
            if code:
                try:
                    client_info = await client_registry.resolve(cimd_client_id)
                    if client_info and client_info.registration_source in ("cimd", "cimd-matched"):
                        tokens = await confidential_relay.exchange_code(code, cimd_client_id)
                        logger.info(f"CIMD token exchange: client_id={cimd_client_id}")
                        # Capture id_token mapping for XAA token store
                        if tokens.get("access_token") and tokens.get("id_token"):
                            _capture_token_mapping(
                                tokens["access_token"],
                                tokens["id_token"],
                                tokens.get("refresh_token"),
                                cimd_client_id,
                                tokens.get("expires_in", 3600),
                            )
                        return JSONResponse(tokens)
                except RelayError as e:
                    logger.error(f"CIMD relay code exchange failed: {e}")
                    return JSONResponse(
                        {"error": "invalid_grant", "error_description": str(e)},
                        status_code=400,
                    )
                except Exception as e:
                    logger.error(f"CIMD token exchange error: {e}")
                    # Fall through to standard flow

        elif grant_type == "refresh_token":
            rt = body.get("refresh_token")
            if rt:
                try:
                    tokens = await confidential_relay.refresh_token(
                        rt, cimd_client_id, scope=body.get("scope", "")
                    )
                    logger.info(f"CIMD token refresh: client_id={cimd_client_id}")
                    # Capture refreshed id_token mapping for XAA token store
                    if tokens.get("access_token") and tokens.get("id_token"):
                        _capture_token_mapping(
                            tokens["access_token"],
                            tokens["id_token"],
                            tokens.get("refresh_token"),
                            cimd_client_id,
                            tokens.get("expires_in", 3600),
                        )
                    return JSONResponse(tokens)
                except RelayError as e:
                    logger.error(f"CIMD relay refresh failed: {e}")
                    return JSONResponse(
                        {"error": "invalid_grant", "error_description": str(e)},
                        status_code=400,
                    )
                except Exception as e:
                    logger.error(f"CIMD token refresh error: {e}")
                    # Fall through to standard flow

    # Check for DCR client_id before standard credential extraction.
    # The client_id may be in the POST body or in the Basic auth header.
    dcr_token_client_id = body.get("client_id", "")
    if not dcr_token_client_id:
        _auth_hdr = request.headers.get("authorization", "")
        if _auth_hdr.lower().startswith("basic "):
            try:
                _decoded = base64.b64decode(_auth_hdr[6:]).decode("utf-8")
                if ":" in _decoded:
                    dcr_token_client_id = _decoded.split(":", 1)[0]
            except Exception:
                pass
    if dcr_token_client_id and not ClientRegistry._is_cimd_url(dcr_token_client_id):
        dcr_info = client_registry._resolve_dcr(dcr_token_client_id)
        if dcr_info is not None:
            if grant_type == "authorization_code":
                code = body.get("code")
                if code:
                    try:
                        tokens = await confidential_relay.exchange_code(
                            code, dcr_token_client_id
                        )
                        logger.info(f"DCR token exchange: client_id={dcr_token_client_id}")
                        if tokens.get("access_token") and tokens.get("id_token"):
                            _capture_token_mapping(
                                tokens["access_token"],
                                tokens["id_token"],
                                tokens.get("refresh_token"),
                                dcr_token_client_id,
                                tokens.get("expires_in", 3600),
                            )
                        await emit_audit_event(
                            AuditEventType.DCR_TOKEN_EXCHANGE_SUCCESS,
                            details={
                                "dcr_client_id": dcr_token_client_id,
                                "grant_type": "authorization_code",
                            },
                        )
                        return JSONResponse(tokens)
                    except RelayError as e:
                        logger.error(f"DCR relay code exchange failed: {e}")
                        await emit_audit_event(
                            AuditEventType.DCR_TOKEN_EXCHANGE_FAILURE,
                            severity=AuditSeverity.WARNING,
                            details={
                                "dcr_client_id": dcr_token_client_id,
                                "grant_type": "authorization_code",
                                "error": str(e),
                            },
                            outcome="failure",
                        )
                        return JSONResponse(
                            {"error": "invalid_grant", "error_description": str(e)},
                            status_code=400,
                        )
                    except Exception as e:
                        logger.error(f"DCR token exchange error: {e}")
                        await emit_audit_event(
                            AuditEventType.DCR_TOKEN_EXCHANGE_FAILURE,
                            severity=AuditSeverity.WARNING,
                            details={
                                "dcr_client_id": dcr_token_client_id,
                                "grant_type": "authorization_code",
                                "error": str(e),
                            },
                            outcome="failure",
                        )
                        # Fall through to standard flow

            elif grant_type == "refresh_token":
                rt = body.get("refresh_token")
                if rt:
                    try:
                        tokens = await confidential_relay.refresh_token(
                            rt, dcr_token_client_id, scope=body.get("scope", "")
                        )
                        logger.info(f"DCR token refresh: client_id={dcr_token_client_id}")
                        if tokens.get("access_token") and tokens.get("id_token"):
                            _capture_token_mapping(
                                tokens["access_token"],
                                tokens["id_token"],
                                tokens.get("refresh_token"),
                                dcr_token_client_id,
                                tokens.get("expires_in", 3600),
                            )
                        await emit_audit_event(
                            AuditEventType.DCR_TOKEN_EXCHANGE_SUCCESS,
                            details={
                                "dcr_client_id": dcr_token_client_id,
                                "grant_type": "refresh_token",
                            },
                        )
                        return JSONResponse(tokens)
                    except RelayError as e:
                        logger.error(f"DCR relay refresh failed: {e}")
                        await emit_audit_event(
                            AuditEventType.DCR_TOKEN_EXCHANGE_FAILURE,
                            severity=AuditSeverity.WARNING,
                            details={
                                "dcr_client_id": dcr_token_client_id,
                                "grant_type": "refresh_token",
                                "error": str(e),
                            },
                            outcome="failure",
                        )
                        return JSONResponse(
                            {"error": "invalid_grant", "error_description": str(e)},
                            status_code=400,
                        )
                    except Exception as e:
                        logger.error(f"DCR token refresh error: {e}")
                        await emit_audit_event(
                            AuditEventType.DCR_TOKEN_EXCHANGE_FAILURE,
                            severity=AuditSeverity.WARNING,
                            details={
                                "dcr_client_id": dcr_token_client_id,
                                "grant_type": "refresh_token",
                                "error": str(e),
                            },
                            outcome="failure",
                        )
                        # Fall through to standard flow

    # Extract client credentials from Basic header or POST body
    client_id, client_secret, err = _extract_client_credentials(request, body)
    if err:
        return err

    logger.info(f"BFF token request: grant_type={grant_type}, client_id={client_id}")

    if grant_type == "authorization_code":
        return await _proxy_authorization_code(request, client_id, body)
    elif grant_type == "refresh_token":
        return await _proxy_refresh_token(request, client_id, body)
    else:
        return JSONResponse(
            {"error": "unsupported_grant_type"},
            status_code=400,
        )


def _capture_token_mapping(access_token, id_token, refresh_token, client_id, expires_in):
    """Non-fatal capture of access_token → id_token mapping for XAA."""
    try:
        from okta_agent_proxy.auth.user_token_store import capture_token_mapping
        capture_token_mapping(access_token, id_token, refresh_token, client_id, expires_in)
    except Exception as e:
        logger.warning(f"[BFF] Failed to capture token mapping: {e}")


async def _proxy_authorization_code(request: Request, client_id: str, body: dict):
    """Proxy an authorization_code exchange to Okta."""
    code = body.get("code")
    if not code:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "code is required"},
            status_code=400,
        )

    token_data = {
        "grant_type": "authorization_code",
        "code": code,
    }
    if body.get("redirect_uri"):
        token_data["redirect_uri"] = body["redirect_uri"]
    if body.get("code_verifier"):
        token_data["code_verifier"] = body["code_verifier"]

    okta_token_url = _get_okta_token_url()
    logger.info(f"Proxying auth code exchange to Okta for client_id={client_id}")

    # Pass the Authorization header straight through — do NOT decode and re-encode
    proxy_headers = {
        "Content-Type": "application/x-www-form-urlencoded",
    }
    auth_header = request.headers.get("authorization")
    if auth_header:
        proxy_headers["Authorization"] = auth_header

    # ISPM: Include adapter's AI Agent ID for Okta System Log attribution
    _adapter_agent_id = os.getenv("OKTA_AI_AGENT_ID", "")
    if _adapter_agent_id:
        proxy_headers["X-Okta-Agent-Id"] = _adapter_agent_id

    try:
        async with httpx.AsyncClient() as http_client:
            okta_response = await http_client.post(
                okta_token_url,
                data=token_data,
                headers=proxy_headers,
                timeout=10,
            )
    except httpx.HTTPError as e:
        logger.error(f"Failed to reach Okta token endpoint: {e}")
        return JSONResponse(
            {"error": "bad_gateway", "error_description": "Failed to reach authorization server"},
            status_code=502,
        )

    if okta_response.status_code != 200:
        # Pass through Okta's error response unchanged
        try:
            error_body = okta_response.json()
        except Exception:
            error_body = {"error": "server_error", "error_description": okta_response.text}
        logger.error(
            f"Okta token exchange failed: status={okta_response.status_code} "
            f"error={error_body.get('error')} desc={error_body.get('error_description')}"
        )
        return JSONResponse(error_body, status_code=okta_response.status_code)

    token_response = okta_response.json()
    logger.info("Successfully exchanged auth code with Okta")

    # Capture access_token → id_token mapping for XAA (non-fatal)
    _capture_token_mapping(
        access_token=token_response.get("access_token"),
        id_token=token_response.get("id_token"),
        refresh_token=token_response.get("refresh_token"),
        client_id=client_id,
        expires_in=token_response.get("expires_in"),
    )

    # Return Okta's real access_token to the agent (full OIDC)
    id_token = token_response.get("id_token")
    response_to_client = {
        "token_type": "Bearer",
        "expires_in": token_response.get("expires_in", 3600),
        "access_token": token_response.get("access_token"),
    }

    if id_token:
        response_to_client["id_token"] = id_token

    if token_response.get("refresh_token"):
        response_to_client["refresh_token"] = token_response["refresh_token"]

    logger.info("Returning tokens to client")
    return JSONResponse(response_to_client)


async def _proxy_refresh_token(request: Request, client_id: str, body: dict):
    """Proxy a refresh_token exchange to Okta."""
    refresh_token = body.get("refresh_token")
    if not refresh_token:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "refresh_token is required"},
            status_code=400,
        )

    token_data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    if body.get("scope"):
        token_data["scope"] = body["scope"]

    okta_token_url = _get_okta_token_url()
    logger.info(f"Proxying refresh token exchange to Okta for client_id={client_id}")

    try:
        async with httpx.AsyncClient() as http_client:
            # Pass the Authorization header straight through — do NOT decode and re-encode
            proxy_headers = {
                "Content-Type": "application/x-www-form-urlencoded",
            }
            auth_header = request.headers.get("authorization")
            if auth_header:
                proxy_headers["Authorization"] = auth_header

            # ISPM: Include adapter's AI Agent ID for Okta System Log attribution
            _adapter_agent_id = os.getenv("OKTA_AI_AGENT_ID", "")
            if _adapter_agent_id:
                proxy_headers["X-Okta-Agent-Id"] = _adapter_agent_id

            okta_response = await http_client.post(
                okta_token_url,
                data=token_data,
                headers=proxy_headers,
                timeout=10,
            )
    except httpx.HTTPError as e:
        logger.error(f"Failed to reach Okta token endpoint: {e}")
        return JSONResponse(
            {"error": "bad_gateway", "error_description": "Failed to reach authorization server"},
            status_code=502,
        )

    if okta_response.status_code != 200:
        logger.error(f"Okta refresh token failed: status={okta_response.status_code}")
        try:
            error_body = okta_response.json()
        except Exception:
            error_body = {"error": "server_error", "error_description": okta_response.text}
        return JSONResponse(error_body, status_code=okta_response.status_code)

    token_response = okta_response.json()
    logger.info(f"Successfully refreshed token via Okta for client_id={client_id}")

    # Capture access_token → id_token mapping for XAA (non-fatal)
    _capture_token_mapping(
        access_token=token_response.get("access_token"),
        id_token=token_response.get("id_token"),
        refresh_token=token_response.get("refresh_token"),
        client_id=client_id,
        expires_in=token_response.get("expires_in"),
    )

    # Return Okta's real access_token to the agent (full OIDC)
    id_token = token_response.get("id_token")
    response_to_client = {
        "token_type": "Bearer",
        "expires_in": token_response.get("expires_in", 3600),
        "access_token": token_response.get("access_token"),
    }

    if id_token:
        response_to_client["id_token"] = id_token

    if token_response.get("refresh_token"):
        response_to_client["refresh_token"] = token_response["refresh_token"]

    logger.info("Returning refreshed tokens to client")
    return JSONResponse(response_to_client)


async def oauth_authorize(request: Request):
    """Gateway authorization endpoint — intercepts CIMD and DCR clients, passes through others.

    For CIMD clients (URL-based client_id):
      - Fetches and validates the CIMD document
      - Starts the confidential relay flow
      - Redirects user to Okta via relay app

    For DCR clients (dcr_* client_id):
      - If linked to an imported agent → relay with that agent's credentials
      - If unlinked + 1 selectable agent → auto-link, redirect back to self
      - If unlinked + N selectable agents → redirect to agent selection page
      - If unlinked + 0 selectable agents → 503 error

    For traditional clients (opaque client_id):
      - Redirects directly to Okta's authorization endpoint
    """
    from starlette.responses import RedirectResponse, HTMLResponse
    from datetime import datetime, timezone

    client_id = request.query_params.get("client_id", "")
    redirect_uri = request.query_params.get("redirect_uri", "")
    state = request.query_params.get("state", "")
    scope = request.query_params.get("scope", "openid offline_access")
    # Append extra scopes from env var for bearer-passthrough resources
    # that need the user's Org AS token to carry specific permissions.
    import os as _os
    extra_scopes = _os.environ.get("GATEWAY_EXTRA_SCOPES", "")
    if extra_scopes:
        existing = set(scope.split())
        for s in extra_scopes.split():
            existing.add(s)
        scope = " ".join(sorted(existing))
    response_type = request.query_params.get("response_type", "code")
    code_challenge = request.query_params.get("code_challenge", "")
    code_challenge_method = request.query_params.get("code_challenge_method", "")
    target_resource = request.query_params.get("resource", "")  # RFC 8707

    if not client_id:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "client_id is required"},
            status_code=400,
        )

    # Check if this is a CIMD client (URL-based client_id)
    if ClientRegistry._is_cimd_url(client_id):
        try:
            client_info = await client_registry.resolve(client_id)
        except Exception as e:
            logger.error(f"CIMD resolve error for {client_id}: {e}")
            return JSONResponse(
                {"error": "invalid_client", "error_description": f"Failed to resolve CIMD client: {e}"},
                status_code=400,
            )

        if client_info is None:
            return JSONResponse(
                {"error": "invalid_client", "error_description": "CIMD client rejected by trust policy"},
                status_code=403,
            )

        if client_info.registration_source not in ("cimd", "cimd-matched"):
            return JSONResponse(
                {"error": "invalid_client", "error_description": "Client resolved but not via CIMD"},
                status_code=400,
            )

        # For cimd-matched agents, fetch CIMD metadata if not already present.
        # The relay needs it to validate redirect_uris.
        cimd_metadata = client_info.cimd_metadata
        if cimd_metadata is None and client_info.registration_source == "cimd-matched":
            try:
                cimd_metadata = await cimd_fetcher.fetch_and_validate(client_id)
                logger.info(f"CIMD authorize: fetched metadata for cimd-matched client {client_id}")
            except Exception as e:
                logger.error(f"CIMD authorize: failed to fetch metadata for {client_id}: {e}")
                return JSONResponse(
                    {"error": "invalid_client", "error_description": f"Failed to fetch CIMD metadata: {e}"},
                    status_code=400,
                )

        # Build auth params for the relay
        auth_params = {
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": scope,
        }
        if code_challenge:
            auth_params["code_challenge"] = code_challenge
        if code_challenge_method:
            auth_params["code_challenge_method"] = code_challenge_method
        if target_resource:
            auth_params["resource"] = target_resource

        # Extract agent's Okta credentials for the relay
        relay_cid = ""
        relay_secret = ""
        if client_info.agent_config:
            relay_cid = client_info.agent_config.get("client_id", "")
            relay_secret = client_info.agent_config.get("client_secret", "")

        try:
            okta_url = await confidential_relay.start_authorization(
                cimd_metadata, auth_params,
                relay_client_id=relay_cid,
                relay_client_secret=relay_secret,
            )
            logger.info(f"CIMD authorize: relaying {client_id} to Okta")
            return RedirectResponse(url=okta_url, status_code=302)
        except RelayError as e:
            logger.error(f"CIMD relay start error: {e}")
            return JSONResponse(
                {"error": "invalid_request", "error_description": str(e)},
                status_code=400,
            )

    # ---- DCR client resolution ----
    dcr_client_info = client_registry._resolve_dcr(client_id)
    if dcr_client_info is not None:
        agent_cfg = dcr_client_info.agent_config
        has_okta_creds = (
            agent_cfg is not None
            and agent_cfg.get("client_id")
            and agent_cfg.get("client_secret")
            and not agent_cfg.get("client_id", "").startswith("dcr_")  # linked agent has real Okta creds
        )

        if has_okta_creds:
            # Linked — relay through the linked agent's Okta app
            dcr_metadata = CIMDMetadata(
                client_id=client_id,
                client_name=dcr_client_info.client_name,
                redirect_uris=dcr_client_info.redirect_uris,
                grant_types=dcr_client_info.grant_types,
                response_types=dcr_client_info.response_types,
                token_endpoint_auth_method=dcr_client_info.token_endpoint_auth_method,
                jwks_uri=None,
                logo_uri=None,
                client_uri=None,
                scope=dcr_client_info.scope,
                domain="dcr",
                fetched_at=datetime.now(timezone.utc),
                raw_json={},
            )
            auth_params = {
                "redirect_uri": redirect_uri,
                "state": state,
                "scope": scope,
            }
            if code_challenge:
                auth_params["code_challenge"] = code_challenge
            if code_challenge_method:
                auth_params["code_challenge_method"] = code_challenge_method
            if target_resource:
                auth_params["resource"] = target_resource

            try:
                okta_url = await confidential_relay.start_authorization(
                    dcr_metadata, auth_params,
                    relay_client_id=agent_cfg["client_id"],
                    relay_client_secret=agent_cfg["client_secret"],
                )
                await emit_audit_event(
                    AuditEventType.DCR_AUTHORIZE_RELAYED,
                    details={
                        "dcr_client_id": client_id,
                        "client_name": dcr_client_info.client_name,
                        "linked_agent": agent_cfg.get("agent_name", ""),
                    },
                )
                logger.info(f"DCR authorize: relaying {client_id} to Okta")
                return RedirectResponse(url=okta_url, status_code=302)
            except RelayError as e:
                await emit_audit_event(
                    AuditEventType.DCR_AUTHORIZE_RELAY_FAILED,
                    severity=AuditSeverity.WARNING,
                    details={
                        "dcr_client_id": client_id,
                        "error": str(e),
                    },
                    outcome="failure",
                )
                logger.error(f"DCR relay start error: {e}")
                return JSONResponse(
                    {"error": "invalid_request", "error_description": str(e)},
                    status_code=400,
                )

        # Unlinked — need agent selection
        selectable = dcr_handler.get_selectable_agents()

        if len(selectable) == 0:
            await emit_audit_event(
                AuditEventType.DCR_AGENT_SELECTION_FAILED,
                severity=AuditSeverity.WARNING,
                details={
                    "dcr_client_id": client_id,
                    "reason": "no_selectable_agents",
                },
                outcome="failure",
            )
            return JSONResponse(
                {
                    "error": "temporarily_unavailable",
                    "error_description": (
                        "No agents are available for linking. "
                        "An administrator must import an agent and mark it as DCR-selectable."
                    ),
                },
                status_code=503,
            )

        # Preserve original authorize params for resumption after selection
        original_params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "scope": scope,
            "response_type": response_type,
        }
        if code_challenge:
            original_params["code_challenge"] = code_challenge
        if code_challenge_method:
            original_params["code_challenge_method"] = code_challenge_method

        if len(selectable) == 1:
            # Auto-link and redirect back to self
            target = selectable[0]
            await dcr_handler.link_to_agent(
                client_id, target["agent_name"], user="auto-link"
            )
            resume_url = f"{os.getenv('GATEWAY_BASE_URL', 'http://localhost:8000')}/oauth/authorize?{urlencode(original_params)}"
            return RedirectResponse(url=resume_url, status_code=302)

        # Multiple selectable agents — redirect to selection page
        selection_state = secrets.token_urlsafe(32)
        await _store_dcr_selection_session(selection_state, {
            "dcr_client_id": client_id,
            "client_name": dcr_client_info.client_name,
            "original_params": original_params,
        })

        await emit_audit_event(
            AuditEventType.DCR_AGENT_SELECTION_SHOWN,
            details={
                "dcr_client_id": client_id,
                "client_name": dcr_client_info.client_name,
                "selectable_agents": [a["agent_name"] for a in selectable],
            },
        )

        gateway_base = os.getenv("GATEWAY_BASE_URL", "http://localhost:8000")
        select_url = f"{gateway_base}/oauth/dcr-select?session={selection_state}"
        return RedirectResponse(url=select_url, status_code=302)

    # Non-CIMD, non-DCR client — redirect directly to Okta's authorization endpoint
    okta_issuer = os.getenv("OKTA_ISSUER")
    if not okta_issuer:
        okta_issuer = f"https://{config.gateway.okta_domain}"

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": response_type,
        "state": state,
        "scope": scope,
    }
    if code_challenge:
        params["code_challenge"] = code_challenge
    if code_challenge_method:
        params["code_challenge_method"] = code_challenge_method

    okta_url = f"{okta_issuer}/v1/authorize?{urlencode(params)}"
    return RedirectResponse(url=okta_url, status_code=302)


async def oauth_dcr_select(request: Request):
    """GET /oauth/dcr-select — Serve agent selection HTML page."""
    from starlette.responses import HTMLResponse

    selection_state = request.query_params.get("session", "")
    if not selection_state:
        return HTMLResponse("<h1>Error</h1><p>Missing session parameter.</p>", status_code=400)

    session_data = await _get_dcr_selection_session(selection_state)
    if session_data is None:
        return HTMLResponse(
            "<h1>Session Expired</h1><p>Your agent selection session has expired. "
            "Please restart the authorization flow.</p>",
            status_code=400,
        )

    selectable = dcr_handler.get_selectable_agents()
    client_name = session_data.get("client_name", "Unknown Client")

    # Build agent option rows
    agent_rows = ""
    for agent in selectable:
        name = agent.get("agent_name", "")
        agent_rows += (
            f'<label style="display:block;padding:12px;margin:8px 0;border:1px solid #ddd;'
            f'border-radius:6px;cursor:pointer;background:#fafafa">'
            f'<input type="radio" name="agent_name" value="{name}" required '
            f'style="margin-right:10px">'
            f'<strong>{name}</strong>'
            f'</label>\n'
        )

    html = f"""<!DOCTYPE html>
<html>
<head><title>Select Agent — Okta MCP Adapter</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px;
         margin: 60px auto; padding: 0 20px; color: #333; }}
  h1 {{ font-size: 1.4em; }}
  .btn {{ background: #0066cc; color: #fff; border: none; padding: 12px 24px;
          border-radius: 6px; font-size: 1em; cursor: pointer; width: 100%; margin-top: 16px; }}
  .btn:hover {{ background: #0052a3; }}
</style>
</head>
<body>
<h1>Select an Agent</h1>
<p><strong>{client_name}</strong> needs to connect through an Okta agent.
   Choose which agent to use:</p>
<form method="POST" action="/oauth/dcr-link">
  <input type="hidden" name="session" value="{selection_state}">
  {agent_rows}
  <button type="submit" class="btn">Continue</button>
</form>
</body>
</html>"""
    return HTMLResponse(html)


async def oauth_dcr_link(request: Request):
    """POST /oauth/dcr-link — Handle agent selection form submission."""
    from starlette.responses import RedirectResponse

    form = await request.form()
    selection_state = form.get("session", "")
    agent_name = form.get("agent_name", "")

    if not selection_state or not agent_name:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "Missing session or agent_name"},
            status_code=400,
        )

    session_data = await _consume_dcr_selection_session(selection_state)
    if session_data is None:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "Session expired or already used"},
            status_code=400,
        )

    dcr_client_id = session_data["dcr_client_id"]
    original_params = session_data["original_params"]

    success, msg = await dcr_handler.link_to_agent(dcr_client_id, agent_name, user="dcr-select")
    if not success:
        await emit_audit_event(
            AuditEventType.DCR_AGENT_SELECTION_FAILED,
            severity=AuditSeverity.WARNING,
            details={
                "dcr_client_id": dcr_client_id,
                "agent_name": agent_name,
                "reason": msg,
            },
            outcome="failure",
        )
        return JSONResponse(
            {"error": "invalid_request", "error_description": msg},
            status_code=400,
        )

    # Resume the authorization flow
    gateway_base = os.getenv("GATEWAY_BASE_URL", "http://localhost:8000")
    resume_url = f"{gateway_base}/oauth/authorize?{urlencode(original_params)}"
    return RedirectResponse(url=resume_url, status_code=302)


async def oauth_pre_consent(request: Request):
    """Kick off a standalone pre-consent flow for a specific agent.

    The user clicks a link like /oauth/pre-consent?agent_id=<id> and is
    redirected to Okta to authenticate against the agent's own Okta app
    (piggyback). After authentication, /oauth/callback dispatches to the
    pre-consent handler, which creates a standalone consent transaction
    and drops the user on the normal consent interstitial.

    Query params:
        agent_id: Required. The agent whose STS connections we're verifying.
        resource: Optional. RFC 8707 resource indicator for path-scoped re-verification.
    """
    from starlette.responses import RedirectResponse

    agent_id = request.query_params.get("agent_id", "").strip()
    target_resource = request.query_params.get("resource") or None

    if not agent_id:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "Missing agent_id"},
            status_code=400,
        )

    # Look up the agent config (includes decrypted Okta credentials)
    agent_config = store.get_agent(agent_id, enabled_only=True)
    if not agent_config:
        return JSONResponse(
            {"error": "unknown_agent", "error_description": f"No enabled agent found for agent_id={agent_id}"},
            status_code=404,
        )

    relay_client_id = agent_config.get("client_id", "")
    relay_client_secret = agent_config.get("client_secret", "")
    if not relay_client_id or not relay_client_secret:
        return JSONResponse(
            {
                "error": "agent_not_configured",
                "error_description": "Agent has no Okta client credentials configured",
            },
            status_code=400,
        )

    # Pre-consent hits the Okta *org* authorization server, which only supports
    # OIDC scopes (openid, profile, email, etc.) — not custom scopes like mcp:read.
    # We only need an id_token for downstream STS verification probes, so filter
    # the agent's scopes down to known OIDC scopes and ensure "openid" is present.
    _OIDC_SCOPES = {"openid", "profile", "email", "address", "phone", "offline_access"}
    scopes_list = agent_config.get("scopes", ["openid", "profile", "email"])
    if isinstance(scopes_list, str):
        scopes_list = scopes_list.split()
    oidc_scopes = [s for s in scopes_list if s in _OIDC_SCOPES]
    if "openid" not in oidc_scopes:
        oidc_scopes.insert(0, "openid")
    scopes_str = " ".join(oidc_scopes)

    await emit_audit_event(
        AuditEventType.STS_PRECONSENT_INITIATED,
        details={
            "agent_id": agent_id,
            "target_resource": target_resource,
            "ip_address": request.client.host if request.client else "",
            "user_agent": request.headers.get("user-agent", "")[:256],
        },
    )

    try:
        okta_url = await confidential_relay.start_preconsent_authorization(
            agent_id=agent_id,
            relay_client_id=relay_client_id,
            relay_client_secret=relay_client_secret,
            scopes=scopes_str,
            target_resource=target_resource,
        )
    except RelayError as e:
        logger.error(f"Pre-consent start error for agent_id={agent_id}: {e}")
        return JSONResponse(
            {"error": "relay_error", "error_description": str(e)},
            status_code=500,
        )

    logger.info(f"Pre-consent: redirecting user to Okta for agent_id={agent_id}")
    return RedirectResponse(url=okta_url, status_code=302)


async def oauth_callback(request: Request):
    """Handle the relay callback from Okta after CIMD client authorization."""
    code = request.query_params.get("code")
    state = request.query_params.get("state")

    # Handle Okta error responses (e.g., invalid_scope, access_denied).
    # Okta redirects back with ?state=...&error=...&error_description=...
    okta_error = request.query_params.get("error")
    if okta_error and state:
        okta_error_desc = request.query_params.get("error_description", "")
        logger.warning(
            f"Okta returned error on callback: error={okta_error} "
            f"description={okta_error_desc} state={state[:8]}..."
        )
        return JSONResponse(
            {"error": okta_error, "error_description": okta_error_desc},
            status_code=400,
        )

    if not code or not state:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "Missing code or state parameter"},
            status_code=400,
        )

    # Dispatch: pre-consent sessions have their own handler path.
    # Normal CIMD relay flow falls through below.
    if confidential_relay.is_preconsent_state(state):
        return await _handle_preconsent_callback(request, code, state)

    try:
        from starlette.responses import RedirectResponse
        import hashlib as _hashlib
        import asyncio

        # Get tokens without issuing a gateway code yet — we may need to
        # run STS consent checks before the agent receives its code.
        callback_result = await confidential_relay.handle_callback_tokens_only(state, code)
        original_client_id = callback_result["original_client_id"]

        # Resolve agent config for this client
        agent_config = None
        agent_id = None
        try:
            client_info = await client_registry.resolve(original_client_id)
            if client_info and client_info.agent_config:
                agent_config = client_info.agent_config
                agent_id = agent_config.get("agent_id", "")
        except Exception as e:
            logger.debug(f"Could not resolve agent for consent check: {e}")

        # Check for STS connections
        has_sts = False
        matching_sts_count = 0
        target_resource = callback_result.get("target_resource")

        if agent_config and agent_id:
            sts_resources = consent_service.get_sts_resources(agent_id, agent_config)
            # Apply path scoping to determine whether the interstitial is needed
            matching_resources = consent_service.filter_resources_by_target(
                sts_resources, target_resource
            )
            matching_sts_count = len(matching_resources)
            has_sts = matching_sts_count > 0

        if not has_sts:
            # Fast path: no STS connections need verification (either none exist,
            # or none match the target_resource for a path-scoped flow)
            gateway_code = confidential_relay._code_manager.issue_code(
                client_id=original_client_id,
                tokens={
                    "access_token": callback_result["access_token"],
                    "id_token": callback_result["id_token"],
                    "refresh_token": callback_result.get("refresh_token"),
                    "expires_in": callback_result.get("expires_in"),
                },
                extra={
                    "relay_client_id": callback_result.get("relay_client_id", ""),
                    "relay_client_secret": callback_result.get("relay_client_secret", ""),
                },
            )
            redirect_params = {"code": gateway_code, "state": callback_result["original_state"]}
            redirect_url = f"{callback_result['original_redirect_uri']}?{urlencode(redirect_params)}"
            logger.info(
                f"Relay callback: no STS verification needed, redirecting {original_client_id} "
                f"(target_resource={target_resource!r})"
            )
            return RedirectResponse(url=redirect_url, status_code=302)

        # --- STS connections exist: create consent transaction ---
        ua_hash = _hashlib.sha256(
            request.headers.get("user-agent", "").encode()
        ).hexdigest()[:16]

        transaction = consent_store.create(
            original_redirect_uri=callback_result["original_redirect_uri"],
            original_state=callback_result["original_state"],
            original_client_id=original_client_id,
            id_token=callback_result["id_token"],
            access_token=callback_result["access_token"],
            refresh_token=callback_result.get("refresh_token"),
            okta_expires_in=callback_result.get("expires_in"),
            agent_id=agent_id,
            agent_config=agent_config,
            ip_address=request.client.host if request.client else "",
            user_agent_hash=ua_hash,
            relay_client_id=callback_result.get("relay_client_id", ""),
            relay_client_secret=callback_result.get("relay_client_secret", ""),
            target_resource=callback_result.get("target_resource"),
        )

        await emit_audit_event(
            AuditEventType.STS_CONSENT_TX_CREATED,
            details={
                "transaction_id": transaction.transaction_id,
                "agent_id": agent_id,
                "client_id": original_client_id,
                "mode": "oauth_return",
                "sts_resource_count": len(sts_resources),
                "target_resource": callback_result.get("target_resource"),
            },
        )

        # Kick off async consent verification
        asyncio.create_task(consent_service.verify_all(transaction))

        # Set session cookie and redirect to interstitial
        response = RedirectResponse(
            url=f"/oauth/consent-verify?tx={transaction.transaction_id}",
            status_code=302,
        )
        response.set_cookie(
            "__okta_consent_session",
            value=transaction.session_id,
            httponly=True,
            secure=request.url.hostname not in ("localhost", "127.0.0.1"),
            samesite="lax",
            path="/oauth",
            max_age=600,
        )
        logger.info(
            f"Relay callback: {matching_sts_count} STS connections need verification "
            f"(target_resource={target_resource!r}), "
            f"redirecting to consent interstitial (tx={transaction.transaction_id[:8]}...)"
        )
        return response

    except RelayError as e:
        logger.error(f"Relay callback error: {e}")
        return JSONResponse(
            {"error": "relay_error", "error_description": str(e)},
            status_code=400,
        )


async def _handle_preconsent_callback(request: Request, code: str, state: str):
    """Handle the Okta callback for a standalone pre-consent flow.

    This is dispatched from oauth_callback when the state matches a
    PreConsentSession. Unlike the normal relay callback, there is no
    gateway code issuance and no return redirect to a client.
    """
    from starlette.responses import HTMLResponse, RedirectResponse
    import hashlib as _hashlib
    import asyncio

    try:
        result = await confidential_relay.handle_preconsent_callback(state, code)
    except RelayError as e:
        logger.error(f"Pre-consent callback error: {e}")
        return JSONResponse(
            {"error": "relay_error", "error_description": str(e)},
            status_code=400,
        )

    agent_id = result["agent_id"]
    id_token = result["id_token"]
    target_resource = result.get("target_resource")

    # Re-fetch the agent config — we need the full config for STS resource filtering
    agent_config = store.get_agent(agent_id, enabled_only=True)
    if not agent_config:
        logger.error(f"Pre-consent callback: agent_id={agent_id} no longer exists or is disabled")
        return JSONResponse(
            {"error": "unknown_agent"},
            status_code=404,
        )

    await emit_audit_event(
        AuditEventType.STS_PRECONSENT_AUTHENTICATED,
        details={
            "agent_id": agent_id,
            "ip_address": request.client.host if request.client else "",
            "user_agent": request.headers.get("user-agent", "")[:256],
        },
    )

    # Filter STS resources by target_resource (same logic as the normal relay callback)
    sts_resources = consent_service.get_sts_resources(agent_id, agent_config)
    matching_resources = consent_service.filter_resources_by_target(
        sts_resources, target_resource
    )

    if not matching_resources:
        # Nothing to verify — render "all set" page directly
        logger.info(
            f"Pre-consent: no matching STS resources for agent_id={agent_id} "
            f"(target_resource={target_resource!r})"
        )
        return HTMLResponse(_build_preconsent_nothing_to_verify_html(agent_id))

    # Create a standalone consent transaction
    ua_hash = _hashlib.sha256(
        request.headers.get("user-agent", "").encode()
    ).hexdigest()[:16]

    transaction = consent_store.create(
        mode="standalone",
        id_token=id_token,
        agent_id=agent_id,
        agent_config=agent_config,
        target_resource=target_resource,
        ip_address=request.client.host if request.client else "",
        user_agent_hash=ua_hash,
        # OAuth-return fields are empty in standalone mode
        original_client_id="",
        original_redirect_uri="",
        original_state="",
        access_token="",
        refresh_token=None,
        okta_expires_in=None,
        relay_client_id="",
        relay_client_secret="",
    )

    await emit_audit_event(
        AuditEventType.STS_CONSENT_TX_CREATED,
        details={
            "transaction_id": transaction.transaction_id,
            "agent_id": agent_id,
            "client_id": "",  # no CIMD client in standalone mode
            "mode": "standalone",
            "sts_resource_count": len(matching_resources),
            "target_resource": target_resource,
        },
    )

    # Kick off async verification
    asyncio.create_task(consent_service.verify_all(transaction))

    # Redirect to the interstitial with the standalone session cookie
    response = RedirectResponse(
        url=f"/oauth/consent-verify?tx={transaction.transaction_id}",
        status_code=302,
    )
    response.set_cookie(
        "__okta_consent_session",
        value=transaction.session_id,
        httponly=True,
        secure=request.url.hostname not in ("localhost", "127.0.0.1"),
        samesite="lax",
        path="/oauth",
        max_age=600,
    )
    logger.info(
        f"Pre-consent: {len(matching_resources)} STS resources need verification "
        f"for agent_id={agent_id} (tx={transaction.transaction_id[:8]}...)"
    )
    return response


def _build_preconsent_nothing_to_verify_html(agent_id: str) -> str:
    """Render the 'nothing to verify' page shown when a pre-consent flow
    finds no matching STS resources for the agent.
    """
    from html import escape as _esc
    safe_agent_id = _esc(agent_id)

    return f"""<!DOCTYPE html>
<html>
<head>
<title>All Set — Okta MCP Adapter</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 520px;
         margin: 60px auto; padding: 0 20px; color: #333; }}
  h1 {{ font-size: 1.4em; margin-bottom: 8px; }}
  .subtitle {{ color: #666; margin-bottom: 24px; }}
  .checkmark {{ color: #1a7f37; font-size: 3em; text-align: center; margin: 24px 0; }}
  .hint {{ color: #999; font-size: 0.9em; margin-top: 32px; }}
</style>
</head>
<body>
  <div class="checkmark">&#10003;</div>
  <h1>Nothing to authorize</h1>
  <p class="subtitle">
    No STS-managed connections require verification for this agent.
  </p>
  <p>You can close this tab and return to your client.</p>
  <p class="hint">Agent: {safe_agent_id}</p>
</body>
</html>"""


def _build_preconsent_complete_html(verified: int, skipped: int, errors: int) -> str:
    """Render the standalone pre-consent completion page."""
    total = verified + skipped + errors
    summary_parts = []
    if verified:
        summary_parts.append(f"{verified} authorized")
    if skipped:
        summary_parts.append(f"{skipped} skipped")
    if errors:
        summary_parts.append(f"{errors} error{'s' if errors != 1 else ''}")
    summary = ", ".join(summary_parts) if summary_parts else "nothing to do"

    return f"""<!DOCTYPE html>
<html>
<head>
<title>All Set — Okta MCP Adapter</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 520px;
         margin: 60px auto; padding: 0 20px; color: #333; }}
  h1 {{ font-size: 1.4em; margin-bottom: 8px; }}
  .subtitle {{ color: #666; margin-bottom: 24px; }}
  .checkmark {{ color: #1a7f37; font-size: 3em; text-align: center; margin: 24px 0; }}
  .summary {{ background: #f6f8fa; padding: 16px; border-radius: 6px;
              text-align: center; font-size: 1.05em; margin: 24px 0; }}
  .hint {{ color: #999; font-size: 0.9em; margin-top: 32px; }}
</style>
</head>
<body>
  <div class="checkmark">&#10003;</div>
  <h1>You're all set</h1>
  <p class="subtitle">Pre-consent verification complete.</p>
  <div class="summary">{summary} of {total} connection{'s' if total != 1 else ''}</div>
  <p>You can close this tab and return to your client.</p>
  <p class="hint">Any future calls from your agent will use the authorizations you just granted.</p>
</body>
</html>"""


async def oauth_consent_verify(request: Request):
    """Serve the STS consent verification interstitial page."""
    from starlette.responses import HTMLResponse

    tx_id = request.query_params.get("tx", "")
    session_id = request.cookies.get("__okta_consent_session", "")

    if not tx_id or not session_id:
        return HTMLResponse(
            "<h1>Invalid Request</h1><p>Missing transaction or session.</p>",
            status_code=400,
        )

    import hashlib as _hashlib
    ua_hash = _hashlib.sha256(
        request.headers.get("user-agent", "").encode()
    ).hexdigest()[:16]

    tx = consent_store.validate_session(
        session_id=session_id,
        ip_address=request.client.host if request.client else "",
        user_agent_hash=ua_hash,
    )

    if not tx or tx.transaction_id != tx_id:
        return HTMLResponse(
            "<h1>Session Invalid</h1><p>Your consent session has expired or is invalid. "
            "Please restart the authorization flow.</p>",
            status_code=403,
        )

    html = _build_consent_interstitial_html(
        tx_id,
        is_standalone=(tx.mode == "standalone"),
    )
    return HTMLResponse(html)


def _build_consent_interstitial_html(tx_id: str, is_standalone: bool = False) -> str:
    """Build the consent verification interstitial HTML page.

    Args:
        tx_id: The consent transaction ID.
        is_standalone: If True, render copy for the standalone pre-consent flow
                       (no "return to client" affordance). If False (default),
                       render the normal oauth_return copy.
    """
    title = "Authorize New Connections" if is_standalone else "Verifying Access"
    subtitle = (
        "Grant access to the connections below. You can return to your client when done."
        if is_standalone
        else "We're verifying your access to the connections this agent needs."
    )
    continue_label = "Finish" if is_standalone else "Continue"

    return f"""<!DOCTYPE html>
<html>
<head>
<title>{title} — Okta MCP Adapter</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 520px;
         margin: 60px auto; padding: 0 20px; color: #333; }}
  h1 {{ font-size: 1.4em; margin-bottom: 8px; }}
  .subtitle {{ color: #666; margin-bottom: 24px; }}
  .spinner {{ display: inline-block; width: 20px; height: 20px; border: 2px solid #ddd;
              border-top: 2px solid #0066cc; border-radius: 50%; animation: spin 0.8s linear infinite;
              vertical-align: middle; margin-right: 8px; }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  .consent-item {{ padding: 14px 16px; margin: 8px 0; border: 1px solid #ddd; border-radius: 8px;
                   display: flex; align-items: center; justify-content: space-between; }}
  .consent-item.verified {{ border-color: #28a745; background: #f0fff4; }}
  .consent-item.pending {{ border-color: #ffc107; background: #fffef5; }}
  .consent-item.error {{ border-color: #dc3545; background: #fff5f5; }}
  .status-badge {{ font-size: 0.85em; padding: 2px 8px; border-radius: 12px; font-weight: 500; }}
  .status-badge.verified {{ background: #d4edda; color: #155724; }}
  .status-badge.pending {{ background: #fff3cd; color: #856404; }}
  .status-badge.error {{ background: #f8d7da; color: #721c24; }}
  .btn {{ display: inline-block; padding: 10px 20px; border-radius: 6px; font-size: 0.95em;
          cursor: pointer; border: none; text-decoration: none; margin: 4px; }}
  .btn-primary {{ background: #0066cc; color: #fff; }}
  .btn-primary:hover {{ background: #0052a3; }}
  .btn-secondary {{ background: #f0f0f0; color: #333; border: 1px solid #ddd; }}
  .btn-secondary:hover {{ background: #e0e0e0; }}
  .btn-consent {{ background: #0066cc; color: #fff; padding: 6px 14px; font-size: 0.85em; }}
  .btn-consent:hover {{ background: #0052a3; }}
  .actions {{ margin-top: 20px; text-align: center; }}
  #error-section {{ display: none; color: #dc3545; margin-top: 16px; }}
  .hidden {{ display: none; }}
</style>
</head>
<body>
<h1 id="title">{title}</h1>
<p id="subtitle" class="subtitle">{subtitle}</p>

<div id="spinner-section">
  <p><span class="spinner"></span> Checking connections...</p>
</div>

<div id="connections-section" class="hidden"></div>

<div id="actions-section" class="hidden actions">
  <button class="btn btn-primary" onclick="recheck()">I've completed authorizations</button>
  <button class="btn btn-secondary" onclick="skipAndContinue()">Skip remaining and {continue_label.lower()}</button>
</div>

<div id="complete-section" class="hidden">
  <p>All verified — {"completing..." if is_standalone else "redirecting to your application..."}</p>
  <form id="complete-form" method="POST" action="/oauth/consent-complete">
    <input type="hidden" name="tx" value="{tx_id}">
  </form>
</div>

<div id="error-section"></div>

<script>
var TX_ID = "{tx_id}";
var polling = null;
var isRechecking = false;

function poll() {{
  fetch("/oauth/consent-status?tx=" + TX_ID, {{ credentials: "same-origin" }})
    .then(function(r) {{ return r.json(); }})
    .then(function(data) {{
      if (data.error) {{
        showError(data.error === "session_expired" ? "Session expired. Please restart." : "Session invalid.");
        stopPolling();
        return;
      }}
      renderStatus(data);
    }})
    .catch(function(e) {{ console.error("Poll error:", e); }});
}}

function renderStatus(data) {{
  var conns = data.connections || [];
  if (data.status === "verifying" && conns.length === 0) return;

  var hasConsents = false;
  var allDone = true;
  var html = "";
  for (var i = 0; i < conns.length; i++) {{
    var c = conns[i];
    var cls = c.status === "verified" ? "verified" : (c.status === "consent_required" ? "pending" : (c.status === "error" ? "error" : ""));
    var badge = c.status === "verified" ? "Verified" : (c.status === "consent_required" ? "Needs consent" : (c.status === "error" ? "Error" : "Checking..."));
    html += '<div class="consent-item ' + cls + '">';
    html += '<span><strong>' + c.provider + '</strong></span>';
    html += '<span>';
    if (c.status === "consent_required" && c.interaction_uri) {{
      html += '<a href="' + c.interaction_uri + '" target="_blank" class="btn btn-consent">Authorize</a> ';
      hasConsents = true;
      allDone = false;
    }}
    html += '<span class="status-badge ' + cls + '">' + badge + '</span>';
    html += '</span></div>';
    if (c.status === "pending" || c.status === "checking") allDone = false;
  }}

  document.getElementById("connections-section").innerHTML = html;
  document.getElementById("connections-section").classList.remove("hidden");

  if (data.status === "complete" || (allDone && !hasConsents)) {{
    document.getElementById("title").textContent = "All verified — redirecting...";
    document.getElementById("subtitle").textContent = "";
    document.getElementById("spinner-section").classList.add("hidden");
    document.getElementById("actions-section").classList.add("hidden");
    document.getElementById("complete-section").classList.remove("hidden");
    stopPolling();
    setTimeout(function() {{ document.getElementById("complete-form").submit(); }}, 1000);
  }} else if (hasConsents) {{
    document.getElementById("title").textContent = "Action required";
    document.getElementById("subtitle").textContent = "Some services need your authorization. Click the buttons below to authorize, then return here.";
    document.getElementById("spinner-section").classList.add("hidden");
    document.getElementById("actions-section").classList.remove("hidden");
    isRechecking = false;
  }} else {{
    document.getElementById("spinner-section").classList.remove("hidden");
  }}
}}

function recheck() {{
  if (isRechecking) return;
  isRechecking = true;
  document.getElementById("title").textContent = "Re-verifying consents...";
  document.getElementById("spinner-section").classList.remove("hidden");
  fetch("/oauth/consent-recheck", {{
    method: "POST",
    headers: {{ "Content-Type": "application/x-www-form-urlencoded" }},
    body: "tx=" + TX_ID,
    credentials: "same-origin"
  }}).then(function() {{ poll(); }})
    .catch(function(e) {{ isRechecking = false; console.error("Recheck error:", e); }});
}}

function skipAndContinue() {{
  fetch("/oauth/consent-skip", {{
    method: "POST",
    headers: {{ "Content-Type": "application/x-www-form-urlencoded" }},
    body: "tx=" + TX_ID,
    credentials: "same-origin"
  }}).then(function() {{
    document.getElementById("complete-form").submit();
  }}).catch(function(e) {{ console.error("Skip error:", e); }});
}}

function showError(msg) {{
  document.getElementById("error-section").style.display = "block";
  document.getElementById("error-section").innerHTML = "<p>" + msg + "</p>";
  document.getElementById("spinner-section").classList.add("hidden");
}}

function stopPolling() {{ if (polling) clearInterval(polling); }}

// Start polling
polling = setInterval(poll, 3000);
poll();

// Hybrid: auto-recheck when user returns to tab
document.addEventListener("visibilitychange", function() {{
  if (!document.hidden) recheck();
}});
</script>
</body>
</html>"""


async def oauth_consent_status(request: Request):
    """Polling endpoint: return current consent verification status."""
    tx_id = request.query_params.get("tx", "")
    session_id = request.cookies.get("__okta_consent_session", "")

    if not tx_id or not session_id:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    import hashlib as _hashlib
    ua_hash = _hashlib.sha256(
        request.headers.get("user-agent", "").encode()
    ).hexdigest()[:16]

    tx = consent_store.validate_session(
        session_id=session_id,
        ip_address=request.client.host if request.client else "",
        user_agent_hash=ua_hash,
    )

    if not tx or tx.transaction_id != tx_id:
        return JSONResponse({"error": "session_invalid"}, status_code=403)

    if tx.is_expired:
        return JSONResponse({"error": "session_expired", "status": "expired"}, status_code=410)

    return JSONResponse({
        "status": tx.status,
        "connections": [
            {
                "resource_name": c.resource_name,
                "provider": c.provider,
                "status": c.status,
                "interaction_uri": c.interaction_uri if c.status == "consent_required" else None,
            }
            for c in tx.connections
        ],
    })


async def oauth_consent_complete(request: Request):
    """Complete the consent flow — branches by transaction mode."""
    from starlette.responses import RedirectResponse as _Redirect, HTMLResponse

    form = await request.form()
    tx_id = form.get("tx", "")
    session_id = request.cookies.get("__okta_consent_session", "")

    if not tx_id or not session_id:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    import hashlib as _hashlib
    ua_hash = _hashlib.sha256(
        request.headers.get("user-agent", "").encode()
    ).hexdigest()[:16]

    tx = consent_store.validate_session(
        session_id=session_id,
        ip_address=request.client.host if request.client else "",
        user_agent_hash=ua_hash,
    )

    if not tx or tx.transaction_id != tx_id:
        return HTMLResponse(
            "<h1>Session Expired</h1><p>Your consent session has expired. "
            "Please restart the authorization flow.</p>",
            status_code=400,
        )

    # Branch by mode
    if tx.mode == "standalone":
        verified = sum(1 for c in tx.connections if c.status == "verified")
        skipped = sum(1 for c in tx.connections if c.status in ("skipped", "consent_required"))
        errors = sum(1 for c in tx.connections if c.status == "error")

        await emit_audit_event(
            AuditEventType.STS_CONSENT_TX_COMPLETED,
            details={
                "transaction_id": tx.transaction_id,
                "agent_id": tx.agent_id,
                "client_id": "",
                "mode": "standalone",
                "verified_count": verified,
                "skipped_count": skipped,
                "error_count": errors,
            },
        )

        consent_store.remove(tx.transaction_id)

        response = HTMLResponse(
            _build_preconsent_complete_html(verified, skipped, errors)
        )
        response.delete_cookie("__okta_consent_session", path="/oauth")
        logger.info(
            f"Pre-consent complete: agent_id={tx.agent_id} "
            f"(tx={tx.transaction_id[:8]}..., {verified}v/{skipped}s/{errors}e)"
        )
        return response

    # --- oauth_return mode (existing behavior) ---
    gateway_code = confidential_relay._code_manager.issue_code(
        client_id=tx.original_client_id,
        tokens={
            "access_token": tx.access_token,
            "id_token": tx.id_token,
            "refresh_token": tx.refresh_token,
            "expires_in": tx.okta_expires_in,
        },
        extra={
            "relay_client_id": tx.relay_client_id,
            "relay_client_secret": tx.relay_client_secret,
        },
    )

    redirect_params = {"code": gateway_code, "state": tx.original_state}
    redirect_url = f"{tx.original_redirect_uri}?{urlencode(redirect_params)}"

    await emit_audit_event(
        AuditEventType.STS_CONSENT_TX_COMPLETED,
        details={
            "transaction_id": tx.transaction_id,
            "agent_id": tx.agent_id,
            "client_id": tx.original_client_id,
            "mode": "oauth_return",
            "verified_count": sum(1 for c in tx.connections if c.status == "verified"),
            "skipped_count": sum(1 for c in tx.connections if c.status in ("skipped", "consent_required")),
            "error_count": sum(1 for c in tx.connections if c.status == "error"),
        },
    )

    consent_store.remove(tx.transaction_id)

    response = _Redirect(url=redirect_url, status_code=302)
    response.delete_cookie("__okta_consent_session", path="/oauth")

    logger.info(
        f"Consent complete: redirecting {tx.original_client_id} "
        f"(tx={tx.transaction_id[:8]}...)"
    )
    return response


async def oauth_consent_recheck(request: Request):
    """Trigger re-verification of pending consents."""
    form = await request.form()
    tx_id = form.get("tx", "")
    session_id = request.cookies.get("__okta_consent_session", "")

    if not tx_id or not session_id:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    import hashlib as _hashlib
    ua_hash = _hashlib.sha256(
        request.headers.get("user-agent", "").encode()
    ).hexdigest()[:16]

    tx = consent_store.validate_session(
        session_id=session_id,
        ip_address=request.client.host if request.client else "",
        user_agent_hash=ua_hash,
    )

    if not tx or tx.transaction_id != tx_id:
        return JSONResponse({"error": "session_invalid"}, status_code=403)

    # Re-verify pending consents
    await consent_service.recheck_pending(tx)

    return JSONResponse({"status": tx.status})


async def oauth_consent_skip(request: Request):
    """Mark remaining consent_required connections as skipped."""
    form = await request.form()
    tx_id = form.get("tx", "")
    session_id = request.cookies.get("__okta_consent_session", "")

    if not tx_id or not session_id:
        return JSONResponse({"error": "invalid_request"}, status_code=400)

    import hashlib as _hashlib
    ua_hash = _hashlib.sha256(
        request.headers.get("user-agent", "").encode()
    ).hexdigest()[:16]

    tx = consent_store.validate_session(
        session_id=session_id,
        ip_address=request.client.host if request.client else "",
        user_agent_hash=ua_hash,
    )

    if not tx or tx.transaction_id != tx_id:
        return JSONResponse({"error": "session_invalid"}, status_code=403)

    for conn in tx.connections:
        if conn.status == "consent_required":
            conn.status = "skipped"
    tx.skip_requested = True
    tx.status = "complete"

    await emit_audit_event(
        AuditEventType.STS_CONSENT_TX_SKIPPED,
        details={
            "transaction_id": tx.transaction_id,
            "skipped_providers": [c.provider for c in tx.connections if c.status == "skipped"],
        },
    )

    return JSONResponse({"status": "complete"})


async def health_check(request: Request):
    """Health check endpoint - returns gateway status"""
    try:
        # Check that config store is accessible
        resources_count = len(store.get_all_resources())
        agents_count = len(store.get_all_agents(enabled_only=False))

        # Check cache health
        cache_provider = type(cache_service.l2).__name__
        try:
            cache_healthy = await cache_service.health_check()
        except Exception:
            cache_healthy = False

        return JSONResponse({
            "status": "healthy",
            "service": config.name,
            "version": config.version,
            "resources_loaded": resources_count,
            "agents_loaded": agents_count,
            "cache_provider": cache_provider,
            "cache_healthy": cache_healthy,
        })
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse({
            "status": "unhealthy",
            "error": str(e)
        }, status_code=503)


async def unified_mcp_endpoint(request: Request):
    """Unified MCP endpoint at POST / — consolidates tools from all resources."""
    if request.method == "DELETE":
        # Streamable HTTP session termination (MCP spec)
        logger.info("MCP session DELETE received — acknowledged")
        return JSONResponse({}, status_code=200)

    if request.method == "GET":
        # GET / returns basic info (some MCP clients probe with GET)
        return JSONResponse({
            "name": "Okta MCP Gateway",
            "version": "1.0.0",
            "description": "Unified MCP gateway with tool consolidation"
        })

    try:
        content_length = request.headers.get("content-length", "0")
        if int(content_length) == 0:
            return JSONResponse({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32600, "message": "Invalid Request: Empty body."}
            }, status_code=400)

        body = await request.json()
        response_body, http_status, extra_headers = await unified_handler.handle(
            body, dict(request.headers)
        )

        # For notifications (no id), return 200 with no body
        if not response_body:
            return JSONResponse({}, status_code=200)

        response = JSONResponse(response_body, status_code=http_status)
        for k, v in extra_headers.items():
            response.headers[k] = v
        return response

    except Exception as e:
        logger.error(f"Unified MCP endpoint error: {e}", exc_info=True)
        return JSONResponse({
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -32603, "message": "Internal error", "data": str(e)}
        }, status_code=500)


async def mcp_proxy(request: Request):
    """Main MCP proxy handler - forwards all requests to appropriate resource"""
    body = None
    try:
        # Check if request has a body (MCP uses JSON-RPC 2.0 which requires POST with JSON)
        content_length = request.headers.get("content-length", "0")
        if int(content_length) == 0:
            return JSONResponse({
                "jsonrpc": "2.0",
                "id": None,
                "error": {
                    "code": -32600,  # Invalid Request
                    "message": "Invalid Request: Empty body. MCP requires JSON-RPC 2.0 format.",
                }
            }, status_code=400)

        # Parse JSON-RPC request body
        body = await request.json()

        # Extract MCP request parameters
        method = body.get("method")
        params = body.get("params")
        request_id = body.get("id")

        # Handle notifications/initialized — no-op, return 200 immediately
        # This is a JSON-RPC notification (no response expected by the client).
        if method == "notifications/initialized":
            return JSONResponse(
                {"jsonrpc": "2.0", "id": request_id, "result": {}},
                status_code=200,
            )

        # Get authorization header
        auth_header = request.headers.get("authorization")

        # Get request path (remove leading slash if present)
        request_path = request.url.path

        # Forward to proxy handler
        result = await proxy_handler.proxy_request(
            request_path=request_path,
            method=method,
            params=params,
            auth_header=auth_header,
            request_id=request_id,
            headers=dict(request.headers)
        )

        # Build JSON-RPC response
        response = {
            "jsonrpc": "2.0",
            "id": request_id,
        }

        # Handle error vs success result
        if isinstance(result, dict) and "error" in result:
            # Map error types to HTTP status codes
            error_type = result.get("error")
            http_status = 500  # Default to internal error
            extra_headers = {}

            if error_type == "unauthorized":
                http_status = 401
                # Add RFC 9728 WWW-Authenticate header with the path-scoped
                # protected resource metadata URL so RFC 8707-compliant clients
                # can discover the resource indicator for /oauth/authorize.
                try:
                    path_segment = request_path.lstrip("/")
                    if path_segment:
                        gateway_base = config.gateway.gateway_base_url.rstrip("/")
                        metadata_url = (
                            f"{gateway_base}/.well-known"
                            f"/oauth-protected-resource/{path_segment}"
                        )
                        extra_headers["WWW-Authenticate"] = (
                            f'Bearer resource_metadata="{metadata_url}", '
                            f'error="invalid_token", '
                            f'error_description="Authentication required'
                            f' for {request_path}"'
                        )
                except Exception as _e:
                    logger.debug(f"Failed to build WWW-Authenticate header: {_e}")
            elif error_type == "consent_required":
                http_status = 403
            elif error_type in ["forbidden", "authorization_denied", "ambiguous_agent"]:
                http_status = 403
            elif error_type == "not_found":
                http_status = 404
            elif error_type == "backend_error":
                http_status = 502
            elif error_type == "timeout":
                http_status = 504

            # Format as JSON-RPC error
            error_message = result.get("message", "Unknown error")
            error_data = result.get("data", error_type)
            if error_type == "consent_required":
                # Include actionable consent details in the error
                error_message = (
                    result.get("instructions")
                    or f"Consent required for {result.get('provider', 'resource')}"
                )
                error_data = {
                    "type": "consent_required",
                    "consent_url": result.get("consent_url", ""),
                    "provider": result.get("provider", ""),
                    "retry_hint": result.get("retry_hint", ""),
                }

            response["error"] = {
                "code": -32000 - http_status,  # Custom error code based on HTTP status
                "message": error_message,
                "data": error_data,
            }

            return JSONResponse(response, status_code=http_status, headers=extra_headers)
        else:
            response["result"] = result
            return JSONResponse(response)

    except Exception as e:
        logger.error(f"MCP proxy error: {e}", exc_info=True)
        return JSONResponse({
            "jsonrpc": "2.0",
            "id": body.get("id") if body else None,
            "error": {
                "code": -32603,
                "message": "Internal error",
                "data": str(e)
            }
        }, status_code=500)


# Define routes
routes = [
    # Health check (must be before catch-all)
    Route("/health", health_check, methods=["GET"]),
    # Admin API routes (secured with JWT)
    Route("/api/admin/login", admin_routes.admin_login, methods=["POST"]),
    Route("/api/admin/agents", admin_routes.list_agents, methods=["GET"]),
    Route("/api/admin/agents", admin_routes.create_agent, methods=["POST"]),
    # Credential automation (more specific paths BEFORE generic {agent_id})
    Route("/api/admin/agents/{agent_id}/credentials/fetch-secret", credential_routes.fetch_secret, methods=["POST"]),
    Route("/api/admin/agents/{agent_id}/credentials/generate-keypair", credential_routes.generate_keypair, methods=["POST"]),
    Route("/api/admin/agents/{agent_id}/credentials/status", credential_routes.credential_status, methods=["GET"]),
    Route("/api/admin/agents/{agent_id}/dcr-selectable", dcr_routes.update_dcr_selectable, methods=["PUT"]),
    # Agent connection & resource linkage (more specific paths BEFORE generic {agent_id})
    Route("/api/admin/agents/{agent_id}/connections/{connection_id}/link", admin_routes.link_connection_resource, methods=["POST"]),
    Route("/api/admin/agents/{agent_id}/connections/{connection_id}/unlink-resource", admin_routes.unlink_connection_resource, methods=["POST"]),
    Route("/api/admin/agents/{agent_id}/connections/{connection_id}/unlink", admin_routes.unlink_connection_resource, methods=["POST"]),
    Route("/api/admin/agents/{agent_id}/connections/{connection_id}/create-resource", admin_routes.create_resource_for_connection, methods=["POST"]),
    Route("/api/admin/agents/{agent_id}/connections", admin_routes.get_agent_connections, methods=["GET"]),
    Route("/api/admin/agents/{agent_id}", admin_routes.get_agent, methods=["GET"]),
    Route("/api/admin/agents/{agent_id}", admin_routes.update_agent, methods=["PUT"]),
    Route("/api/admin/agents/{agent_id}", admin_routes.delete_agent, methods=["DELETE"]),
    # Linkage CRUD
    Route("/api/admin/linkages", admin_routes.list_linkages, methods=["GET"]),
    Route("/api/admin/linkages", admin_routes.create_linkage, methods=["POST"]),
    Route("/api/admin/linkages", admin_routes.delete_linkage, methods=["DELETE"]),
    # Resources CRUD
    Route("/api/admin/resources/isolation-status", admin_routes.get_resource_isolation_status, methods=["GET"]),
    Route("/api/admin/resources/{name}/audit", admin_routes.get_resource_audit_log, methods=["GET"]),
    Route("/api/admin/resources/{name}", admin_routes.get_resource, methods=["GET"]),
    Route("/api/admin/resources/{name}", admin_routes.update_resource, methods=["PUT"]),
    Route("/api/admin/resources/{name}", admin_routes.delete_resource, methods=["DELETE"]),
    Route("/api/admin/resources", admin_routes.list_resources, methods=["GET"]),
    Route("/api/admin/resources", admin_routes.create_resource, methods=["POST"]),
    # Connection sync
    Route("/api/admin/connections/sync", admin_routes.sync_connections, methods=["POST"]),
    Route("/api/admin/connections/status", admin_routes.connection_status, methods=["GET"]),
    # Routing table
    Route("/api/admin/routes", admin_routes.list_routes, methods=["GET"]),
    # DCR admin routes
    Route("/api/admin/dcr/registrations", dcr_routes.list_dcr_registrations, methods=["GET"]),
    Route("/api/admin/dcr/registrations/{client_id:path}", dcr_routes.get_dcr_registration, methods=["GET"]),
    Route("/api/admin/dcr/registrations/{client_id:path}/revoke", dcr_routes.revoke_dcr_registration, methods=["POST"]),
    Route("/api/admin/dcr/registrations/{client_id:path}/unlink", dcr_routes.unlink_dcr_registration, methods=["POST"]),
    Route("/api/admin/dcr/policy", dcr_routes.get_dcr_policy, methods=["GET"]),
    Route("/api/admin/dcr/policy/redirect-patterns", dcr_routes.get_dcr_redirect_patterns, methods=["GET"]),
    Route("/api/admin/dcr/policy/redirect-patterns", dcr_routes.update_dcr_redirect_patterns, methods=["PUT"]),
    # Okta AI Agent import/sync routes (specific routes BEFORE parameterized)
    Route("/api/admin/okta/agents/bulk-import", okta_import_routes.bulk_import_agents, methods=["POST"]),
    Route("/api/admin/okta/potential-connections", okta_import_routes.list_potential_connections, methods=["GET"]),
    Route("/api/admin/okta/sync/agents", okta_import_routes.sync_all_agents, methods=["POST"]),
    Route("/api/admin/okta/sync/resources", okta_import_routes.sync_all_resources, methods=["POST"]),
    Route("/api/admin/okta/sync/all", okta_import_routes.sync_all, methods=["POST"]),
    Route("/api/admin/okta/agents/{okta_agent_id}/connections", okta_import_routes.create_agent_connection, methods=["POST"]),
    Route("/api/admin/okta/agents/{okta_agent_id}/import", okta_import_routes.import_agent, methods=["POST"]),
    Route("/api/admin/okta/agents/{okta_agent_id}/sync", okta_import_routes.sync_agent, methods=["POST"]),
    Route("/api/admin/okta/agents/{okta_agent_id}", okta_import_routes.get_agent_detail, methods=["GET"]),
    Route("/api/admin/okta/agents", okta_import_routes.list_importable_agents, methods=["GET"]),
    # Audit log routes
    Route("/api/admin/audit", admin_routes.get_audit_log, methods=["GET"]),
    Route("/api/admin/agents/{agent_id}/audit", admin_routes.get_agent_audit_log, methods=["GET"]),
    # Token store admin routes
    Route("/api/admin/token-store/stats", admin_routes.token_store_stats, methods=["GET"]),
    Route("/api/admin/token-store/user/{user_sub}", admin_routes.token_store_delete_user, methods=["DELETE"]),
    # Okta Event Hook (shared key auth — NOT admin auth)
    Route("/api/hooks/okta/events", okta_event_hook.okta_event_hook_verify, methods=["GET"]),
    Route("/api/hooks/okta/events", okta_event_hook.okta_event_hook_receive, methods=["POST"]),
    # OAuth and MCP routes
    Route("/.well-known/oauth-protected-resource", oauth_protected_resource, methods=["GET"]),
    Route("/.well-known/oauth-protected-resource/{resource}", oauth_protected_resource_by_name, methods=["GET"]),
    Route("/.well-known/oauth-authorization-server/{resource}", oauth_authorization_server_by_name, methods=["GET"]),
    Route("/.well-known/oauth-authorization-server", oauth_authorization_server, methods=["GET"]),
    Route("/.well-known/oauth/registration", oauth_registration, methods=["GET", "POST"]),
    Route("/oauth/client-metadata.json", adapter_client_metadata, methods=["GET"]),
    Route("/oauth/jwks.json", adapter_jwks, methods=["GET"]),
    Route("/oauth/backend-callback", adapter_resource_callback, methods=["GET"]),
    Route("/oauth/dcr-select", oauth_dcr_select, methods=["GET"]),
    Route("/oauth/dcr-link", oauth_dcr_link, methods=["POST"]),
    Route("/oauth/authorize", oauth_authorize, methods=["GET"]),
    Route("/oauth/pre-consent", oauth_pre_consent, methods=["GET"]),
    Route("/oauth/callback", oauth_callback, methods=["GET"]),
    Route("/oauth/consent-verify", oauth_consent_verify, methods=["GET"]),
    Route("/oauth/consent-status", oauth_consent_status, methods=["GET"]),
    Route("/oauth/consent-complete", oauth_consent_complete, methods=["POST"]),
    Route("/oauth/consent-recheck", oauth_consent_recheck, methods=["POST"]),
    Route("/oauth/consent-skip", oauth_consent_skip, methods=["POST"]),
Route("/oauth2/v1/token", oauth_token_endpoint, methods=["POST", "OPTIONS"]),
    Route("/", unified_mcp_endpoint, methods=["GET", "POST", "DELETE"]),
    Route("/{path:path}", mcp_proxy, methods=["GET", "POST"]),  # Catch-all for path-based proxy
]

# Create ASGI application with CORS middleware for localhost clients
middleware = [
    Middleware(CorrelationIdMiddleware),
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    ),
]


async def _on_audit_startup():
    """Initialize the audit event emitter on app startup."""
    await init_audit_emitter()
    logger.info("Audit event emitter initialized")


async def _on_audit_shutdown():
    """Shut down the audit event emitter on app shutdown."""
    await shutdown_audit_emitter()
    logger.info("Audit event emitter shut down")


async def _on_startup():
    """Register pub/sub handlers and start the listener on app startup."""
    # Flush stale tool catalog cache from Redis so restarted containers
    # don't serve catalogs discovered by a previous run.
    if cache_service:
        try:
            count = await cache_service.clear_prefix("tool_catalog:")
            logger.info(f"Tool catalog cache flushed on startup ({count} entries cleared)")
        except Exception as e:
            logger.warning(f"Failed to flush tool catalog cache: {e}")
    unified_handler._tool_cache.clear()

    # Route invalidation → refresh in-memory routing table
    async def _on_route_invalidate(message: str):
        logger.info(f"Pub/sub: route invalidation received ({message})")
        router.load_resources_from_store()

    # Agent invalidation → invalidate agent in config cache
    async def _on_agent_invalidate(message: str):
        logger.info(f"Pub/sub: agent invalidation received ({message})")
        from okta_agent_proxy.storage.cached_store import CachedResourceStore
        if isinstance(store, CachedResourceStore):
            try:
                event_bus._cache_service.l1.close()  # clear L1
            except Exception:
                pass

    # Tool catalog invalidation → clear unified handler tool cache (scoped or global)
    async def _on_tool_catalog_invalidate(message: str):
        logger.info(f"Pub/sub: tool catalog invalidation received ({message})")
        # Try to parse JSON for agent-scoped invalidation
        scoped_agent_id = None
        try:
            import json as _json
            parsed = _json.loads(message)
            if isinstance(parsed, dict):
                scoped_agent_id = parsed.get("agent_id")
        except (ValueError, TypeError):
            pass
        unified_handler.invalidate_tool_cache(agent_id=scoped_agent_id)

    await event_bus.subscribe(CHANNEL_ROUTE_INVALIDATE, _on_route_invalidate)
    await event_bus.subscribe(CHANNEL_AGENT_INVALIDATE, _on_agent_invalidate)
    await event_bus.subscribe(CHANNEL_TOOL_CATALOG_INVALIDATE, _on_tool_catalog_invalidate)
    await dcr_policy.register_pubsub_subscriber()
    await event_bus.start_listener()

    # --- Resource Map event bus + syncer startup ---
    if _rm_event_bus:
        # When resources are created/updated/deleted, reload the router
        async def _on_rm_resource_changed(message: str):
            logger.info(f"Resource Map: resource changed ({message}), reloading router")
            router.load_resources_from_store()
            unified_handler.invalidate_tool_cache()

        _rm_event_bus.subscribe(RM_CHANNEL_RESOURCE_CHANGED, _on_rm_resource_changed)
        await _rm_event_bus.start()
        logger.info("Resource Map CacheEventBus started")

    if _rm_syncer:
        await _rm_syncer.start()
        if _rm_syncer._api_token:
            # Service token available — run initial background sync
            try:
                result = await _rm_syncer.sync()
                logger.info(
                    f"Resource Map initial sync: {result.total} resources, "
                    f"{len(result.unresolved)} unresolved, "
                    f"+{len(result.added)} added"
                )
            except Exception as e:
                logger.error(f"Resource Map initial sync failed: {e}")
        else:
            logger.info(
                "Resource Map: OktaConnectionSyncer ready (no service token — "
                "trigger sync from Admin UI)"
            )

    # Verify the adapter's own AI Agent identity in Okta
    await ai_agent_promoter.check_adapter_registration()


async def _on_shutdown():
    """Stop the pub/sub listener and Resource Map components on app shutdown."""
    await event_bus.stop_listener()

    if _rm_syncer:
        await _rm_syncer.stop()
        logger.info("Resource Map syncer stopped")

    if _rm_event_bus:
        await _rm_event_bus.stop()
        logger.info("Resource Map CacheEventBus stopped")


@asynccontextmanager
async def lifespan(app):
    await _on_audit_startup()
    await _on_startup()
    yield
    await _on_shutdown()
    await _on_audit_shutdown()


app = Starlette(
    routes=routes,
    middleware=middleware,
    lifespan=lifespan,
)

logger.info("=" * 80)
logger.info(f"{config.name} v{config.version}")
logger.info(f"Configuration: PostgreSQL with AES-256-GCM encryption")
logger.info(f"MCP Session Cache: TTL=3600s")
logger.info("=" * 80)
