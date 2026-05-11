#!/usr/bin/env python3
"""
End-to-end Okta device authorization flow:
  1. Initiate device auth via API (get device_code + verification URL)
  2. Use Playwright to complete the browser flow (activate, login, consent)
  3. Poll for access token
  4. Save token to /tmp/governance-user-token.txt

Handles:
  - Activation code page
  - Sign In (username + password)
  - MFA/TOTP verification (using pre-enrolled factor)
  - MFA enrollment page (skip or set up TOTP)
  - Consent page
  - Token polling
"""

import asyncio
import json
import sys
import time
import urllib.request
import urllib.parse
from playwright.async_api import async_playwright

# Configuration
OKTA_ORG = "https://taskvantage.okta.com"
AUTH_SERVER_ID = "aus22zgxiud01vsii1d8"
CLIENT_ID = "0oa22znfp27UT1evv1d8"
SCOPES = "openid profile governance:certifications:read governance:reviews:read governance:reviews:manage"
USERNAME = "mcp-testbot@atko.email"
PASSWORD = "MCPtest1234!@#"
TOKEN_FILE = "/tmp/governance-user-token.txt"
DEVICE_CODE_FILE = "/tmp/device-code.txt"

# API endpoints
DEVICE_AUTH_URL = f"{OKTA_ORG}/oauth2/{AUTH_SERVER_ID}/v1/device/authorize"
TOKEN_URL = f"{OKTA_ORG}/oauth2/{AUTH_SERVER_ID}/v1/token"


def initiate_device_auth():
    """Step 1: Initiate the device authorization flow via API."""
    print("=== STEP 1: Initiate device authorization ===")
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "scope": SCOPES,
    }).encode()
    req = urllib.request.Request(DEVICE_AUTH_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())

    device_code = body["device_code"]
    user_code = body["user_code"]
    verification_url = body["verification_uri_complete"]
    expires_in = body["expires_in"]

    print(f"  Device code: {device_code}")
    print(f"  User code: {user_code}")
    print(f"  Verification URL: {verification_url}")
    print(f"  Expires in: {expires_in}s")

    # Save device code
    with open(DEVICE_CODE_FILE, "w") as f:
        f.write(device_code)
    print(f"  Saved device code to {DEVICE_CODE_FILE}")

    return device_code, verification_url


def poll_for_token(device_code, timeout=120, interval=5):
    """Step 3: Poll the token endpoint until we get an access token."""
    print(f"\n=== STEP 3: Polling for token (timeout={timeout}s) ===")
    start = time.time()
    data = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": device_code,
        "client_id": CLIENT_ID,
    }).encode()

    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            with urllib.request.urlopen(req) as resp:
                body = json.loads(resp.read())
                if "access_token" in body:
                    access_token = body["access_token"]
                    scope = body.get("scope", "")
                    token_type = body.get("token_type", "")
                    expires_in = body.get("expires_in", "")
                    print(f"  Token obtained!")
                    print(f"  Type: {token_type}")
                    print(f"  Scope: {scope}")
                    print(f"  Expires in: {expires_in}s")
                    print(f"  Token (first 20 chars): {access_token[:20]}...")
                    with open(TOKEN_FILE, "w") as f:
                        f.write(access_token)
                    print(f"  Saved to {TOKEN_FILE}")
                    return access_token
        except urllib.error.HTTPError as e:
            err_body = json.loads(e.read())
            error = err_body.get("error", "")
            if error == "authorization_pending":
                elapsed = int(time.time() - start)
                print(f"  [{elapsed}s] Authorization pending...")
            elif error == "slow_down":
                interval += 1
                print(f"  Slowing down, interval now {interval}s")
            elif error == "expired_token":
                print("  ERROR: Device code expired!")
                return None
            elif error == "access_denied":
                print("  ERROR: Access denied by user!")
                return None
            else:
                print(f"  ERROR: {error} - {err_body.get('error_description', '')}")
                return None
        except Exception as e:
            print(f"  ERROR polling: {e}")

        time.sleep(interval)

    print("  ERROR: Polling timed out!")
    return None


async def complete_browser_flow(verification_url):
    """Step 2: Use Playwright to complete the browser login flow."""
    print(f"\n=== STEP 2: Browser flow via Playwright ===")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        step = 0

        async def screenshot(label):
            nonlocal step
            step += 1
            path = f"/tmp/device-auth-step{step}-{label}.png"
            await page.screenshot(path=path, full_page=True)
            print(f"  Screenshot: {path}")

        async def click_submit():
            for sel in [
                'input[type="submit"]',
                'button[type="submit"]',
                'input[value="Next"]',
                'button:has-text("Next")',
                'button:has-text("Sign in")',
                'button:has-text("Verify")',
                'input[value="Sign in"]',
                'input[value="Verify"]',
            ]:
                try:
                    loc = page.locator(sel)
                    if await loc.count() > 0 and await loc.first.is_visible():
                        print(f"    Clicking: {sel}")
                        await loc.first.click()
                        return True
                except:
                    continue
            return False

        async def find_field(selectors, name, max_attempts=5):
            for attempt in range(max_attempts):
                for sel in selectors:
                    try:
                        loc = page.locator(sel)
                        if await loc.count() > 0 and await loc.first.is_visible():
                            print(f"  Found {name}: {sel}")
                            return loc.first
                    except:
                        continue
                if attempt < max_attempts - 1:
                    print(f"  Waiting for {name} (attempt {attempt + 1}/{max_attempts})...")
                    await asyncio.sleep(2)
            return None

        try:
            # --- PAGE 1: Activation code ---
            print("  [Page 1] Activation code page")
            await page.goto(verification_url, wait_until="networkidle", timeout=30000)
            await screenshot("activation")

            # Click Next (don't touch the code field - it's pre-filled)
            await click_submit()
            await asyncio.sleep(3)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await screenshot("after-activation")

            # --- PAGE 2: Username ---
            print("  [Page 2] Username")
            username_field = await find_field([
                'input[name="identifier"]',
                'input[id="okta-signin-username"]',
                'input[name="username"]',
            ], "username field")

            if not username_field:
                print("  ERROR: No username field found!")
                await screenshot("error-no-username")
                return False

            await username_field.fill(USERNAME)
            await click_submit()
            await asyncio.sleep(3)
            await page.wait_for_load_state("networkidle", timeout=15000)
            await screenshot("after-username")

            # --- PAGE 2.5: Check for authenticator selection ---
            content = await page.content()
            lower = content.lower()
            if "select from the following" in lower or "verify it's you" in lower or "security method" in lower:
                print("  [Page 2.5] Authenticator selection page detected")
                await screenshot("authenticator-selection")

                # Click "Select" next to "Password"
                # The page has multiple "Select" buttons - we need the one near "Password"
                # Try data-se attribute first, then positional
                password_select_found = False
                for sel in [
                    'div[data-se="okta_password"] button:has-text("Select")',
                    'div[data-se="okta_password"] a:has-text("Select")',
                    'button[data-se="password"]',
                    # Fall back to clicking the second Select button (Password is usually 2nd)
                ]:
                    try:
                        loc = page.locator(sel)
                        if await loc.count() > 0 and await loc.first.is_visible():
                            print(f"    Clicking Password Select: {sel}")
                            await loc.first.click()
                            password_select_found = True
                            break
                    except:
                        continue

                if not password_select_found:
                    # Try to find all Select buttons and click the one associated with Password
                    select_buttons = page.locator('button:has-text("Select"), a:has-text("Select")')
                    count = await select_buttons.count()
                    print(f"    Found {count} Select buttons, looking for Password one...")

                    for i in range(count):
                        btn = select_buttons.nth(i)
                        # Check the parent/surrounding context for "Password"
                        try:
                            parent = btn.locator("xpath=ancestor::div[contains(@class, 'authenticator')]")
                            if await parent.count() > 0:
                                parent_text = await parent.first.inner_text()
                                if "password" in parent_text.lower():
                                    print(f"    Found Password Select at index {i}")
                                    await btn.click()
                                    password_select_found = True
                                    break
                        except:
                            pass

                if not password_select_found:
                    # Last resort: click the last Select button (Password is typically last)
                    select_buttons = page.locator('button:has-text("Select"), a:has-text("Select")')
                    count = await select_buttons.count()
                    if count > 0:
                        print(f"    Fallback: clicking last Select button (index {count-1})")
                        await select_buttons.nth(count - 1).click()
                        password_select_found = True

                if password_select_found:
                    await asyncio.sleep(2)
                    await page.wait_for_load_state("networkidle", timeout=15000)
                    await screenshot("after-password-select")
                else:
                    print("    ERROR: Could not find Password Select button!")
                    return False

            # --- PAGE 3: Password ---
            print("  [Page 3] Password")
            password_field = await find_field([
                'input[name="credentials.passcode"]',
                'input[type="password"]',
                'input[name="password"]',
            ], "password field")

            if not password_field:
                print("  ERROR: No password field found!")
                await screenshot("error-no-password")
                return False

            await password_field.fill(PASSWORD)
            await click_submit()
            await asyncio.sleep(5)
            await page.wait_for_load_state("networkidle", timeout=30000)
            await screenshot("after-password")

            # --- Check what page we landed on ---
            content = await page.content()
            lower = content.lower()
            print(f"  URL: {page.url}")
            print(f"  Title: {await page.title()}")

            # --- Handle MFA enrollment page ---
            if "set up security methods" in lower or "security methods" in lower:
                print("  [MFA Enrollment] Detected MFA enrollment page")
                await screenshot("mfa-enrollment")

                # Since we pre-enrolled TOTP via API, look for "Okta Verify" Set up
                # or try to select the TOTP option
                okta_verify_setup = None
                for sel in [
                    'button:has-text("Set up"):near(:has-text("Okta Verify"))',
                    'a:has-text("Set up")',
                    'button:has-text("Set up")',
                ]:
                    try:
                        loc = page.locator(sel)
                        if await loc.count() > 0 and await loc.first.is_visible():
                            okta_verify_setup = loc.first
                            print(f"  Found Set up button: {sel}")
                            break
                    except:
                        continue

                if okta_verify_setup:
                    # Click Set up for Okta Verify - it should detect we already
                    # have TOTP enrolled and ask for verification instead
                    print("  Clicking Set up for Okta Verify...")
                    await okta_verify_setup.click()
                    await asyncio.sleep(3)
                    await page.wait_for_load_state("networkidle", timeout=15000)
                    await screenshot("after-setup-click")

                    # Now check what happened
                    content = await page.content()
                    lower = content.lower()

                # Check if we're now on a TOTP verification page or still on enrollment
                # If TOTP was pre-enrolled, Okta might ask us to verify with it

            # --- Handle TOTP / MFA verification ---
            # This handles both: post-password TOTP challenge AND enrollment verification
            content = await page.content()
            lower = content.lower()

            # Look for TOTP code input (OIE uses "Enter code from Okta Verify" or similar)
            if any(phrase in lower for phrase in [
                'enter code', 'verification code', 'enter a code',
                'authenticator', 'one-time code', 'passcode',
                'verify with', 'okta verify',
                'select an authenticator', 'choose authenticator',
            ]):
                print("  [MFA] TOTP verification page detected")
                await screenshot("totp-challenge")

                # If we see "Select an authenticator" or similar, we need to pick one
                for sel in [
                    'button:has-text("Select")',
                    'a:has-text("Enter a code")',
                    'button:has-text("Enter a code")',
                    'a:has-text("Enter code")',
                    '[data-se="okta_verify-totp"]',
                    'div[data-se="okta_verify-totp"]',
                ]:
                    try:
                        loc = page.locator(sel)
                        if await loc.count() > 0 and await loc.first.is_visible():
                            print(f"    Selecting authenticator: {sel}")
                            await loc.first.click()
                            await asyncio.sleep(2)
                            await page.wait_for_load_state("networkidle", timeout=10000)
                            await screenshot("after-select-authenticator")
                            break
                    except:
                        continue

                # Generate TOTP code
                try:
                    import pyotp
                    with open("/tmp/totp-secret.txt") as f:
                        totp_secret = f.read().strip()
                    totp = pyotp.TOTP(totp_secret)
                    code = totp.now()
                    print(f"  Generated TOTP code: {code}")
                except Exception as e:
                    print(f"  ERROR generating TOTP: {e}")
                    return False

                # Find the code input field
                code_field = await find_field([
                    'input[name="credentials.passcode"]',
                    'input[name="verificationCode"]',
                    'input[autocomplete="one-time-code"]',
                    'input[type="tel"]',
                    'input[type="text"][name*="code"]',
                    'input[type="text"][name*="passcode"]',
                    'input[data-se="credentials.passcode"]',
                    'input[type="text"]',
                ], "TOTP code field")

                if code_field:
                    await code_field.fill(code)
                    await screenshot("totp-code-entered")
                    await click_submit()
                    await asyncio.sleep(5)
                    await page.wait_for_load_state("networkidle", timeout=30000)
                    await screenshot("after-totp-submit")
                    print(f"  URL after TOTP: {page.url}")
                else:
                    print("  ERROR: Could not find TOTP code input field!")
                    # Dump page text for debugging
                    visible_text = await page.locator("body").inner_text()
                    print(f"  Page text: {visible_text[:1000]}")
                    await screenshot("error-no-totp-field")
                    return False

                # Re-read content after TOTP
                content = await page.content()
                lower = content.lower()

            # --- Handle consent page ---
            consent_clicked = False
            for sel in [
                'input[value="Allow Access"]',
                'button:has-text("Allow Access")',
                'input[value="Allow"]',
                'button:has-text("Allow")',
                'button:has-text("Accept")',
            ]:
                try:
                    loc = page.locator(sel)
                    if await loc.count() > 0 and await loc.first.is_visible():
                        print(f"  [Consent] Found: {sel}")
                        await screenshot("consent")
                        await loc.first.click()
                        consent_clicked = True
                        await asyncio.sleep(3)
                        await page.wait_for_load_state("networkidle", timeout=15000)
                        await screenshot("after-consent")
                        break
                except:
                    continue

            if not consent_clicked:
                print("  [Consent] No consent page detected")

            # --- Final state ---
            final_content = await page.content()
            await screenshot("final")
            final_lower = final_content.lower()
            print(f"  Final URL: {page.url}")
            print(f"  Final title: {await page.title()}")

            if any(w in final_lower for w in ['device activated', 'approved', 'success', 'you can close']):
                print("  SUCCESS: Device authorized!")
                return True
            else:
                # Print visible text for debugging
                visible_text = await page.locator("body").inner_text()
                print(f"  Page text: {visible_text[:500]}")
                return False

        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback
            traceback.print_exc()
            await screenshot("error")
            return False
        finally:
            await browser.close()


async def main():
    # Step 1: Initiate device auth
    device_code, verification_url = initiate_device_auth()

    # Step 2: Complete browser flow
    browser_ok = await complete_browser_flow(verification_url)

    if not browser_ok:
        print("\nBrowser flow did not complete successfully.")
        print("Attempting token poll anyway in case it worked...")

    # Step 3: Poll for token
    token = poll_for_token(device_code, timeout=60)

    if token:
        print(f"\nSUCCESS! Token saved to {TOKEN_FILE}")
        return True
    else:
        print("\nFAILED to obtain token.")
        return False


if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0 if result else 1)
