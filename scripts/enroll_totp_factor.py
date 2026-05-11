#!/usr/bin/env python3
"""
Enroll a TOTP (Google Authenticator compatible) factor for a user via Okta Admin API.
Saves the shared secret so it can be used programmatically with pyotp.
"""

import json
import sys
import urllib.request
import urllib.parse

OKTA_ORG = "https://taskvantage.okta.com"
USERNAME = "mcp-testbot@atko.email"

# Read API key
with open("/home/ubuntu/Taskvantage-prod-apiKey") as f:
    API_KEY = f.read().strip()

HEADERS = {
    "Authorization": f"SSWS {API_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

def api_get(path):
    url = f"{OKTA_ORG}{path}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def api_post(path, data=None):
    url = f"{OKTA_ORG}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  API Error {e.code}: {err}")
        raise


def main():
    # 1. Find the user
    print(f"Looking up user: {USERNAME}")
    users = api_get(f"/api/v1/users?search=profile.login+eq+%22{urllib.parse.quote(USERNAME)}%22")
    if not users:
        print("ERROR: User not found!")
        return False

    user = users[0]
    user_id = user["id"]
    print(f"  User ID: {user_id}")
    print(f"  Status: {user['status']}")

    # 2. Check existing factors
    print(f"\nChecking existing factors...")
    factors = api_get(f"/api/v1/users/{user_id}/factors")
    print(f"  Enrolled factors: {len(factors)}")
    for f in factors:
        print(f"    - {f['factorType']} ({f['provider']}): {f['status']}")
        if f['factorType'] == 'token:software:totp' and f['status'] == 'ACTIVE':
            print("  TOTP factor already enrolled and active!")
            # Check if we have the shared secret saved
            try:
                with open("/tmp/totp-secret.txt") as sf:
                    secret = sf.read().strip()
                    print(f"  Shared secret available at /tmp/totp-secret.txt")
                    return True
            except FileNotFoundError:
                print("  WARNING: TOTP is enrolled but shared secret not saved.")
                print("  You may need to reset the factor and re-enroll.")

    # 3. Check available factor types
    print(f"\nChecking available factor types...")
    try:
        available = api_get(f"/api/v1/users/{user_id}/factors/catalog")
        for af in available:
            print(f"    Available: {af.get('factorType')} ({af.get('provider')}) - status: {af.get('status')}")
    except Exception as e:
        print(f"  Could not list available factors: {e}")

    # 3b. Enroll TOTP factor - try Okta Verify first, then Google Auth
    print(f"\nEnrolling TOTP factor...")

    # Try Okta Verify TOTP first
    enroll_data = {
        "factorType": "token:software:totp",
        "provider": "OKTA",
        "profile": {
            "credentialId": USERNAME
        }
    }
    try:
        result = api_post(f"/api/v1/users/{user_id}/factors", enroll_data)
    except:
        print("  Okta TOTP failed, trying Google...")
        enroll_data["provider"] = "GOOGLE"
        result = api_post(f"/api/v1/users/{user_id}/factors", enroll_data)
    result = api_post(f"/api/v1/users/{user_id}/factors", enroll_data)

    factor_id = result["id"]
    status = result["status"]
    print(f"  Factor ID: {factor_id}")
    print(f"  Status: {status}")

    if status != "PENDING_ACTIVATION":
        print(f"  Unexpected status: {status}")
        print(f"  Full response: {json.dumps(result, indent=2)}")
        return False

    # Extract shared secret
    embedded = result.get("_embedded", {})
    activation = embedded.get("activation", {})
    shared_secret = activation.get("sharedSecret")

    if not shared_secret:
        print("  ERROR: No shared secret in response!")
        print(f"  Response: {json.dumps(result, indent=2)}")
        return False

    print(f"  Shared secret: {shared_secret}")

    # Save shared secret
    with open("/tmp/totp-secret.txt", "w") as f:
        f.write(shared_secret)
    print(f"  Saved to /tmp/totp-secret.txt")

    # 4. Activate the factor with a TOTP code
    print(f"\nActivating factor with TOTP code...")
    try:
        import pyotp
    except ImportError:
        print("  Installing pyotp...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyotp", "-q"])
        import pyotp

    totp = pyotp.TOTP(shared_secret)
    code = totp.now()
    print(f"  Generated TOTP code: {code}")

    activate_data = {"passCode": code}
    activate_result = api_post(f"/api/v1/users/{user_id}/factors/{factor_id}/lifecycle/activate", activate_data)

    activate_status = activate_result.get("status")
    print(f"  Activation status: {activate_status}")

    if activate_status == "ACTIVE":
        print("  TOTP factor enrolled and activated successfully!")
        return True
    else:
        print(f"  Unexpected: {json.dumps(activate_result, indent=2)}")
        return False


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
