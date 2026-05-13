"""
Resource Token Resolver — single source of truth for auth dispatch.

Consolidates the duplicated auth method dispatch logic from:
- UnifiedMCPHandler._get_resource_auth_headers + 3 exchange methods
- ProxyHandler.proxy_request auth dispatch + 3 exchange methods
- ResourceRouter._get_vault_secret_token, _get_sts_service_account_token

Given a resource config, agent config, and user token, returns auth headers.
"""

import base64
import logging
import os
from collections import namedtuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Optional, Any

from okta_agent_proxy.audit import emit_audit_event, AuditEventType, AuditSeverity
from okta_agent_proxy.auth.resource_auth import create_auth_handler

logger = logging.getLogger(__name__)

AgentCredentials = namedtuple(
    "AgentCredentials", ["agent_id", "client_id", "private_key", "principal_id"]
)


@dataclass
class ResourceAuthResult:
    """Result of resolving auth headers for a resource."""

    headers: Optional[Dict[str, str]] = None
    error: Optional[str] = None
    error_message: Optional[str] = None
    consent_required: Optional[Dict] = None

    @property
    def ok(self) -> bool:
        return self.headers is not None


class ResourceTokenResolver:
    """Single source of truth for 'given a resource config + agent + user token, return auth headers.'"""

    def __init__(self, token_cache):
        self.token_cache = token_cache

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def resolve_auth_headers(
        self,
        resource_name: str,
        resource_config,
        agent_config,
        user_id: str,
        user_id_token: str,
        force_refresh: bool = False,
    ) -> ResourceAuthResult:
        """Dispatch to the appropriate auth method and return headers."""
        auth_method = getattr(resource_config, "auth_method", None)

        # Allow per-resource auth method override.
        # Use case: resources that need the user's Org AS token passed through
        # (e.g. Okta Governance end-user API) even though the managed connection
        # auto-derives okta-cross-app from IDENTITY_ASSERTION_CUSTOM_AS.
        # Check config dict first, then env var AUTH_METHOD_OVERRIDE_{RESOURCE_NAME}.
        import os
        config = getattr(resource_config, "config", {}) or {}
        env_key = f"AUTH_METHOD_OVERRIDE_{resource_name.upper().replace('-', '_')}"
        override = config.get("auth_method_override") or os.environ.get(env_key)
        if override:
            auth_method = override

        if not auth_method:
            return ResourceAuthResult(error="invalid_auth_method", error_message="No auth_method on resource config")

        # --- Simple, stateless methods ---
        if auth_method == "bearer-passthrough":
            handler = create_auth_handler("bearer-passthrough", {}, user_token=user_id_token)
            if handler:
                return ResourceAuthResult(headers=await handler.get_auth_headers())
            return ResourceAuthResult(error="auth_handler_failed", error_message="Failed to create bearer-passthrough handler")

        if auth_method == "pre-shared-key":
            auth_config_dict = self._dump_auth_config(resource_config)
            handler = create_auth_handler("pre-shared-key", auth_config_dict)
            if handler:
                return ResourceAuthResult(headers=await handler.get_auth_headers())
            return ResourceAuthResult(error="auth_handler_failed", error_message="Failed to create pre-shared-key handler")

        if auth_method == "service-account":
            auth_config_dict = self._dump_auth_config(resource_config)
            handler = create_auth_handler("service-account", auth_config_dict)
            if handler:
                return ResourceAuthResult(headers=await handler.get_auth_headers())
            return ResourceAuthResult(error="auth_handler_failed", error_message="Failed to create service-account handler")

        # --- Token exchange methods ---
        if auth_method == "okta-cross-app":
            return await self._handle_okta_cross_app(
                resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
            )

        if auth_method == "okta-sts":
            return await self._handle_sts_exchange(
                resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
            )

        if auth_method == "vault-secret":
            return await self._handle_vault_secret_exchange(
                resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
            )

        if auth_method == "sts-service-account":
            return await self._handle_sts_service_account_exchange(
                resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
            )

        logger.error(f"Unknown auth method '{auth_method}' for resource '{resource_name}'")
        return ResourceAuthResult(error="invalid_auth_method", error_message=f"Unknown auth method: {auth_method}")

    # ------------------------------------------------------------------
    # Exchange methods
    # ------------------------------------------------------------------

    async def _handle_okta_cross_app(
        self, resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
    ) -> ResourceAuthResult:
        """Okta Cross-App Access (ID-JAG) token exchange."""
        from okta_agent_proxy.auth.cross_app_access import OktaCrossAppAccessManager
        from okta_agent_proxy.routing.router import ResolvedResourceConfigAdapter

        iso_agent_id, iso_connection_id = self._extract_isolation_fields(resource_config)

        # Check cache (with isolation)
        if not force_refresh:
            cached = self.token_cache.get(
                user_id, resource_name,
                agent_id=iso_agent_id, connection_id=iso_connection_id,
            )
            if cached and isinstance(cached, dict) and "token" in cached:
                expires_at = cached.get("expires_at")
                if expires_at and datetime.now() < expires_at:
                    logger.debug(f"Using cached resource token for {user_id}:{resource_name} agent={iso_agent_id}")
                    handler = create_auth_handler("okta-cross-app", {}, access_token=cached["token"])
                    if handler:
                        return ResourceAuthResult(headers=await handler.get_auth_headers())

        if not agent_config:
            return ResourceAuthResult(error="missing_agent", error_message="okta-cross-app requires agent_config")

        creds = self._extract_agent_credentials(agent_config)

        # Determine target authorization server
        if isinstance(resource_config, ResolvedResourceConfigAdapter):
            target_auth_server_id = resource_config.resource_id
            okta_domain = os.getenv("OKTA_DOMAIN", "")
            if okta_domain and not okta_domain.startswith("http"):
                okta_domain = f"https://{okta_domain}"
            target_authorization_server = f"{okta_domain}/oauth2/{target_auth_server_id}"
            auth_config = resource_config.auth_config.model_dump()
        else:
            auth_config = self._dump_auth_config(resource_config)
            id_jag_mode = auth_config.get("id_jag_mode", "static")
            target_authorization_server = auth_config.get("target_authorization_server")

            if id_jag_mode == "dynamic":
                from okta_agent_proxy.discovery import get_discovery_client
                discovery_client = get_discovery_client()
                discovered = await discovery_client.extract_auth_server_details(
                    resource_config.url, force_refresh=False
                )
                if not discovered:
                    return ResourceAuthResult(error="discovery_failed", error_message=f"Failed to discover auth server for {resource_name}")
                target_authorization_server = discovered.get("target_authorization_server")

            if not target_authorization_server:
                return ResourceAuthResult(error="missing_auth_server", error_message=f"No target_authorization_server for {resource_name}")

            target_auth_server_id = target_authorization_server.split("/oauth2/")[-1] if target_authorization_server else None

        if not target_auth_server_id:
            return ResourceAuthResult(error="missing_auth_server", error_message=f"Cannot extract auth server ID for {resource_name}")

        # Resolve ID token
        id_token_for_exchange = await self._resolve_actual_id_token(user_id_token, resource_name, with_refresh=True)

        try:
            cross_app_manager = OktaCrossAppAccessManager(
                agent_id=creds.agent_id,
                client_id=creds.client_id,
                agent_private_key=creds.private_key,
                okta_domain=os.getenv("OKTA_DOMAIN"),
                target_auth_server_id=target_auth_server_id,
                principal_id=creds.principal_id,
            )
        except Exception as e:
            logger.error(f"Failed to create OktaCrossAppAccessManager for {resource_name}: {e}", exc_info=True)
            return ResourceAuthResult(error="exchanger_init_failed", error_message=str(e))

        # Scope info from ResolvedResourceConfigAdapter
        _resource_scopes = None
        _scope_condition = None
        if isinstance(resource_config, ResolvedResourceConfigAdapter):
            _resource_scopes = resource_config.scopes
            _scope_condition = resource_config.scope_condition.value if hasattr(resource_config.scope_condition, 'value') else str(resource_config.scope_condition)

        try:
            resource_result = await cross_app_manager.exchange_id_token_to_mcp_token(
                user_id_token=id_token_for_exchange,
                resource_name=resource_name,
                target_auth_server_id=target_auth_server_id,
                scopes=None,
                resource_scopes=_resource_scopes,
                scope_condition=_scope_condition,
            )
        except Exception as e:
            logger.error(f"Token exchange failed for {resource_name}: {e}", exc_info=True)
            return ResourceAuthResult(error="token_exchange_failed", error_message=str(e))

        if not resource_result or not resource_result.get("access_token"):
            logger.error(f"Token exchange returned no access_token for {resource_name}")
            return ResourceAuthResult(error="token_exchange_failed", error_message="No access_token in exchange result")

        access_token = resource_result["access_token"]
        expires_in = resource_result.get("expires_in", 3600)

        # Cache (with isolation)
        token_data = {
            "token": access_token,
            "expires_at": datetime.now() + timedelta(seconds=expires_in - 60),
            "expires_in": expires_in,
        }
        self.token_cache.set(
            user_id, resource_name, token_data, ttl_seconds=expires_in,
            agent_id=iso_agent_id, connection_id=iso_connection_id,
        )

        await emit_audit_event(
            AuditEventType.TOKEN_EXCHANGE_SUCCESS,
            resource_name=resource_name,
            details={
                "user_id": user_id, "agent_id": iso_agent_id,
                "connection_id": iso_connection_id, "auth_method": "okta-cross-app",
                "expires_in": expires_in,
            },
        )

        handler = create_auth_handler("okta-cross-app", {}, access_token=access_token)
        if handler:
            return ResourceAuthResult(headers=await handler.get_auth_headers())
        return ResourceAuthResult(error="auth_handler_failed", error_message="Failed to create okta-cross-app handler")

    async def _handle_sts_exchange(
        self, resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
    ) -> ResourceAuthResult:
        """STS brokered token exchange (ISV apps like GitHub, Jira)."""
        from okta_agent_proxy.auth.okta_sts_exchanger import OktaSTSTokenExchanger

        resource_indicator = self._extract_resource_indicator(resource_config)
        if not resource_indicator:
            logger.error(f"No resource_indicator for STS resource '{resource_name}'")
            return ResourceAuthResult(error="missing_resource_indicator", error_message=f"No resource_indicator for {resource_name}")

        # Check cache
        if not force_refresh:
            cached_token = self.token_cache.get_sts_token(user_id, resource_indicator)
            if cached_token:
                logger.info(f"[STS] Cache HIT for {resource_name}")
                handler = create_auth_handler("okta-sts", {}, access_token=cached_token)
                if handler:
                    return ResourceAuthResult(headers=await handler.get_auth_headers())

        creds = self._extract_agent_credentials(agent_config)
        actual_id_token = await self._resolve_actual_id_token(user_id_token, resource_name)

        try:
            exchanger = OktaSTSTokenExchanger(
                agent_id=creds.agent_id,
                client_id=creds.client_id,
                agent_private_key=creds.private_key,
                principal_id=creds.principal_id,
            )
        except Exception as e:
            logger.error(f"Failed to create STS exchanger for {resource_name}: {e}")
            return ResourceAuthResult(error="exchanger_init_failed", error_message=str(e))

        result = await exchanger.exchange(
            user_id_token=actual_id_token,
            resource_indicator=resource_indicator,
            resource_name=resource_name,
        )

        if result and result.get("status") == "success":
            expires_in = result.get("expires_in", 28800)
            self.token_cache.set_sts_token(
                user_id, resource_indicator, result["access_token"], expires_in
            )
            handler = create_auth_handler("okta-sts", {}, access_token=result["access_token"])
            if handler:
                return ResourceAuthResult(headers=await handler.get_auth_headers())

        if result and result.get("status") == "consent_required":
            result["resource_indicator"] = resource_indicator
            return ResourceAuthResult(
                consent_required=result,
                error="consent_required",
                error_message="User consent required",
            )

        return ResourceAuthResult(error="sts_exchange_failed", error_message=f"STS exchange failed for {resource_name}")

    async def _handle_vault_secret_exchange(
        self, resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
    ) -> ResourceAuthResult:
        """Vault secret exchange via OktaVaultSecretExchanger."""
        from okta_agent_proxy.auth.okta_vault_exchanger import OktaVaultSecretExchanger

        iso_agent_id, iso_connection_id = self._extract_isolation_fields(resource_config)

        resource_orn = self._extract_resource_indicator(resource_config)
        if not resource_orn:
            logger.error(f"No resource_orn for vault-secret resource '{resource_name}'")
            return ResourceAuthResult(error="missing_resource_indicator", error_message=f"No resource_orn for {resource_name}")

        # Check cache (with isolation)
        cache_key = f"vault:{resource_name}"
        if not force_refresh:
            cached = self.token_cache.get(
                cache_key, resource_orn,
                agent_id=iso_agent_id, connection_id=iso_connection_id,
            )
            if cached and isinstance(cached, dict) and "token" in cached:
                expires_at = cached.get("expires_at")
                if expires_at and datetime.now() < expires_at:
                    await emit_audit_event(
                        AuditEventType.VAULT_SECRET_CACHE_HIT,
                        resource_name=resource_name,
                        details={"resource_orn": resource_orn, "agent_id": iso_agent_id, "connection_id": iso_connection_id},
                    )
                    return self._vault_secret_to_headers(cached["token"], resource_config)

        creds = self._extract_agent_credentials(agent_config)
        actual_id_token = await self._resolve_actual_id_token(user_id_token, resource_name)

        try:
            exchanger = OktaVaultSecretExchanger(
                agent_id=creds.agent_id,
                client_id=creds.client_id,
                agent_private_key=creds.private_key,
                principal_id=creds.principal_id,
            )
        except Exception as e:
            logger.error(f"Failed to create vault exchanger for {resource_name}: {e}")
            await emit_audit_event(
                AuditEventType.VAULT_SECRET_EXCHANGE_FAILURE,
                AuditSeverity.WARNING,
                resource_name=resource_name,
                details={"resource_orn": resource_orn, "reason": str(e)},
                outcome="failure",
            )
            return ResourceAuthResult(error="exchanger_init_failed", error_message=str(e))

        result = await exchanger.exchange_vault_secret(actual_id_token, resource_orn, resource_name=resource_name)

        if result and result.get("status") == "success":
            ttl = result.get("expires_in") or 300
            token_data = {
                "token": result["access_token"],
                "expires_at": datetime.now() + timedelta(seconds=ttl),
            }
            self.token_cache.set(
                cache_key, resource_orn, token_data, ttl_seconds=ttl,
                agent_id=iso_agent_id, connection_id=iso_connection_id,
            )
            await emit_audit_event(
                AuditEventType.VAULT_SECRET_EXCHANGE_SUCCESS,
                resource_name=resource_name,
                details={"resource_orn": resource_orn, "agent_id": iso_agent_id, "connection_id": iso_connection_id, "expires_in": result.get("expires_in")},
            )
            return self._vault_secret_to_headers(result["access_token"], resource_config)

        if result and result.get("status") == "consent_required":
            return ResourceAuthResult(
                consent_required=result,
                error="consent_required",
                error_message="Consent required for vault secret",
            )

        await emit_audit_event(
            AuditEventType.VAULT_SECRET_EXCHANGE_FAILURE,
            AuditSeverity.WARNING,
            resource_name=resource_name,
            details={"resource_orn": resource_orn, "agent_id": iso_agent_id, "connection_id": iso_connection_id, "reason": "exchange_returned_none"},
            outcome="failure",
        )
        return ResourceAuthResult(error="vault_secret_exchange_failed", error_message=f"Vault exchange failed for {resource_name}")

    async def _handle_sts_service_account_exchange(
        self, resource_name, resource_config, agent_config, user_id, user_id_token, force_refresh
    ) -> ResourceAuthResult:
        """STS service account exchange via OktaVaultSecretExchanger."""
        from okta_agent_proxy.auth.okta_vault_exchanger import OktaVaultSecretExchanger

        iso_agent_id, iso_connection_id = self._extract_isolation_fields(resource_config)

        resource_orn = self._extract_resource_indicator(resource_config)
        if not resource_orn:
            logger.error(f"No resource_orn for sts-service-account resource '{resource_name}'")
            return ResourceAuthResult(error="missing_resource_indicator", error_message=f"No resource_orn for {resource_name}")

        # Check cache (with isolation)
        cache_key = f"sa:{resource_name}"
        if not force_refresh:
            cached = self.token_cache.get(
                cache_key, resource_orn,
                agent_id=iso_agent_id, connection_id=iso_connection_id,
            )
            if cached and isinstance(cached, dict) and "token" in cached:
                expires_at = cached.get("expires_at")
                if expires_at and datetime.now() < expires_at:
                    await emit_audit_event(
                        AuditEventType.STS_SERVICE_ACCOUNT_CACHE_HIT,
                        resource_name=resource_name,
                        details={"resource_orn": resource_orn, "agent_id": iso_agent_id, "connection_id": iso_connection_id},
                    )
                    return self._sa_cached_to_headers(cached["token"])

        creds = self._extract_agent_credentials(agent_config)
        actual_id_token = await self._resolve_actual_id_token(user_id_token, resource_name)

        try:
            exchanger = OktaVaultSecretExchanger(
                agent_id=creds.agent_id,
                client_id=creds.client_id,
                agent_private_key=creds.private_key,
                principal_id=creds.principal_id,
            )
        except Exception as e:
            logger.error(f"Failed to create vault exchanger for {resource_name}: {e}")
            await emit_audit_event(
                AuditEventType.STS_SERVICE_ACCOUNT_EXCHANGE_FAILURE,
                AuditSeverity.WARNING,
                resource_name=resource_name,
                details={"resource_orn": resource_orn, "reason": str(e)},
                outcome="failure",
            )
            return ResourceAuthResult(error="exchanger_init_failed", error_message=str(e))

        result = await exchanger.exchange_service_account(actual_id_token, resource_orn, resource_name=resource_name)

        if result and result.get("status") == "success":
            ttl = result.get("expires_in") or 300
            # Cache as encoded string
            if result.get("username") and result.get("password"):
                creds_str = f"{result['username']}:{result['password']}"
                cache_val = f"Basic {base64.b64encode(creds_str.encode()).decode()}"
            else:
                cache_val = result.get("access_token", "")
            token_data = {
                "token": cache_val,
                "expires_at": datetime.now() + timedelta(seconds=ttl),
            }
            self.token_cache.set(
                cache_key, resource_orn, token_data, ttl_seconds=ttl,
                agent_id=iso_agent_id, connection_id=iso_connection_id,
            )
            await emit_audit_event(
                AuditEventType.STS_SERVICE_ACCOUNT_EXCHANGE_SUCCESS,
                resource_name=resource_name,
                details={"resource_orn": resource_orn, "agent_id": iso_agent_id, "connection_id": iso_connection_id},
            )
            # Return headers
            if result.get("username") and result.get("password"):
                handler = create_auth_handler("sts-service-account", {
                    "username": result["username"],
                    "password": result["password"],
                })
            else:
                handler = create_auth_handler("okta-cross-app", {}, access_token=result.get("access_token", ""))
            if handler:
                return ResourceAuthResult(headers=await handler.get_auth_headers())
            return ResourceAuthResult(error="auth_handler_failed", error_message="Failed to create SA handler")

        if not result:
            await emit_audit_event(
                AuditEventType.STS_SERVICE_ACCOUNT_EXCHANGE_FAILURE,
                AuditSeverity.WARNING,
                resource_name=resource_name,
                details={"resource_orn": resource_orn, "agent_id": iso_agent_id, "connection_id": iso_connection_id, "reason": "exchange_returned_none"},
                outcome="failure",
            )
        return ResourceAuthResult(error="sts_service_account_exchange_failed", error_message=f"SA exchange failed for {resource_name}")

    # ------------------------------------------------------------------
    # Helpers (eliminate duplication across handlers)
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_resource_indicator(resource_config) -> Optional[str]:
        """Extract resource indicator / ORN from resource config (metadata, auth_config, connection_id)."""
        indicator = ""

        if hasattr(resource_config, "metadata"):
            metadata = resource_config.metadata or {}
            indicator = metadata.get("resource_indicator", "") or metadata.get("resource_orn", "")

        if not indicator and hasattr(resource_config, "config"):
            cfg = resource_config.config or {}
            indicator = cfg.get("metadata", {}).get("resource_indicator", "")

        if not indicator and hasattr(resource_config, "auth_config"):
            ac = resource_config.auth_config
            if hasattr(ac, "model_dump"):
                ac = ac.model_dump()
            elif not isinstance(ac, dict):
                ac = {}
            indicator = ac.get("resource_indicator", "")

        if not indicator and hasattr(resource_config, "connection_id"):
            indicator = getattr(resource_config, "connection_id", "")

        return indicator or None

    @staticmethod
    def _extract_agent_credentials(agent_config) -> AgentCredentials:
        """Extract agent credentials from dict or object."""
        if isinstance(agent_config, dict):
            return AgentCredentials(
                agent_id=agent_config.get("agent_id", ""),
                client_id=agent_config.get("client_id", ""),
                private_key=agent_config.get("private_key"),
                principal_id=agent_config.get("principal_id") or agent_config.get("okta_ai_agent_id"),
            )
        return AgentCredentials(
            agent_id=getattr(agent_config, "agent_id", ""),
            client_id=getattr(agent_config, "client_id", ""),
            private_key=getattr(agent_config, "private_key", None),
            principal_id=getattr(agent_config, "principal_id", None) or getattr(agent_config, "okta_ai_agent_id", None),
        )

    @staticmethod
    async def _resolve_actual_id_token(user_id_token: str, resource_name: str, with_refresh: bool = False) -> str:
        """Resolve the real Okta ID token from UserTokenStore (CIMD relay resolution)."""
        actual_id_token = user_id_token
        try:
            from okta_agent_proxy.auth.user_token_store import get_user_token_store
            token_store = get_user_token_store()
            mapping = token_store.lookup(user_id_token)
            if mapping and mapping.get("id_token"):
                stored_id_token = mapping["id_token"]

                if with_refresh:
                    # Check expiry and attempt refresh if needed
                    import time as _time
                    try:
                        from jose import jwt as jose_jwt
                        claims = jose_jwt.get_unverified_claims(stored_id_token)
                        exp = claims.get("exp", 0)
                        if exp > _time.time() + 30:
                            actual_id_token = stored_id_token
                            logger.debug(f"[Auth] Using stored id_token (cache) for {resource_name}")
                        else:
                            from okta_agent_proxy.auth.token_refresher import get_token_refresher
                            refresher = get_token_refresher()
                            fresh = await refresher.refresh_id_token(user_id_token)
                            if fresh:
                                actual_id_token = fresh
                                logger.info(f"[Auth] Using refreshed id_token for {resource_name}")
                            else:
                                logger.warning(f"[Auth] Refresh failed, using Bearer token for {resource_name}")
                    except Exception as e:
                        logger.debug(f"[Auth] Could not check id_token expiry: {e}")
                        actual_id_token = stored_id_token
                else:
                    actual_id_token = stored_id_token
                    logger.info(f"[Auth] Resolved Okta ID token from UserTokenStore for {resource_name}")
            else:
                logger.debug(f"[Auth] No ID token mapping — using raw token for {resource_name}")
        except Exception as e:
            logger.debug(f"[Auth] UserTokenStore lookup failed: {e}")
        return actual_id_token

    @staticmethod
    def _extract_isolation_fields(resource_config) -> tuple:
        """Extract (agent_id, connection_id) from resource config for cache scoping.

        Returns (None, None) for legacy BackendConfig objects.
        """
        agent_id = getattr(resource_config, "agent_id", None)
        connection_id = getattr(resource_config, "connection_id", None)
        return agent_id, connection_id

    @staticmethod
    def _dump_auth_config(resource_config) -> dict:
        """Convert auth_config to dict regardless of type."""
        auth_config = getattr(resource_config, "auth_config", {})
        if hasattr(auth_config, "model_dump"):
            return auth_config.model_dump()
        if hasattr(auth_config, "dict"):
            return auth_config.dict()
        if isinstance(auth_config, dict):
            return auth_config
        return {}

    def _vault_secret_to_headers(self, secret_value: str, resource_config) -> ResourceAuthResult:
        """Build headers from a vault secret value + resource auth_config."""
        auth_cfg = self._dump_auth_config(resource_config)
        handler = create_auth_handler("vault-secret", {
            "secret_value": secret_value,
            "header_name": auth_cfg.get("header_name", "Authorization"),
            "header_prefix": auth_cfg.get("header_prefix", "Bearer"),
        })
        if handler:
            import asyncio
            loop = asyncio.get_event_loop()
            # Since this is always called from async context, use a wrapper
            # Actually, just return the handler and let caller await
            pass
        # We need to return synchronously here but get_auth_headers is async.
        # Return a result that the caller builds. Let's restructure.
        # Actually, VaultSecretAuthHandler.get_auth_headers() is trivially sync
        # (it just formats a string), so we can make a sync version.
        auth_cfg_header = auth_cfg.get("header_name", "Authorization")
        prefix = auth_cfg.get("header_prefix", "Bearer")
        if prefix:
            return ResourceAuthResult(headers={auth_cfg_header: f"{prefix} {secret_value}"})
        return ResourceAuthResult(headers={auth_cfg_header: secret_value})

    def _sa_cached_to_headers(self, cached_token_str: str) -> ResourceAuthResult:
        """Convert cached SA token string back to auth headers."""
        if cached_token_str.startswith("Basic "):
            decoded = base64.b64decode(cached_token_str[6:]).decode()
            u, p = decoded.split(":", 1)
            creds = f"{u}:{p}"
            encoded = base64.b64encode(creds.encode()).decode()
            return ResourceAuthResult(headers={"Authorization": f"Basic {encoded}"})
        return ResourceAuthResult(headers={"Authorization": f"Bearer {cached_token_str}"})
