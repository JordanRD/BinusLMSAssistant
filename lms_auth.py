import base64
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Optional, Dict, Any
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from browser import create_driver, DEFAULT_USER_DATA_DIR

CACHE_FILE = Path(__file__).resolve().parent / ".auth_cache.json"
AES_SECRET_KEY = "%v$4T!9CRqE_[G-="


def decrypt_cryptojs_aes(ciphertext_b64: str, passphrase: str) -> str:
    """Decrypt OpenSSL / CryptoJS AES-256-CBC ciphertext using passphrase."""
    rem = len(ciphertext_b64) % 4
    if rem > 0:
        ciphertext_b64 += "=" * (4 - rem)
    data = base64.b64decode(ciphertext_b64)
    if not data.startswith(b"Salted__"):
        raise ValueError("Invalid CryptoJS format (missing Salted__ prefix)")
    salt = data[8:16]
    ciphertext = data[16:]
    
    # OpenSSL EVP_BytesToKey using MD5
    d = b""
    d_i = b""
    pass_bytes = passphrase.encode("utf-8")
    while len(d) < 48:
        d_i = hashlib.md5(d_i + pass_bytes + salt).digest()
        d += d_i
    key = d[:32]
    iv = d[32:48]
    
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    pad_len = padded[-1]
    return padded[:-pad_len].decode("utf-8")


def parse_jwt_payload(token: str) -> Dict[str, Any]:
    """Extract claims from a JWT."""
    try:
        parts = token.split(".")
        if len(parts) >= 2:
            payload_b64 = parts[1]
            rem = len(payload_b64) % 4
            if rem > 0:
                payload_b64 += "=" * (4 - rem)
            payload_json = base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8")
            return json.loads(payload_json)
    except Exception:
        pass
    return {}


def build_headers_from_auth(auth_res: Dict[str, Any]) -> Dict[str, str]:
    """Construct standard Binus APIM headers from auth response object."""
    token = auth_res.get("token", "")
    active_role = auth_res.get("activeRole") or {}
    roid = auth_res.get("activeRoleOrganizationId") or active_role.get("roleOrganizationId") or ""
    role_id = active_role.get("roleId") or ""
    role_name = active_role.get("name") or "Student"
    academic_career = active_role.get("academicCareer") or "OS1"
    institution = active_role.get("institution") or "BNS01"

    return {
        "Authorization": f"Bearer {token}",
        "roid": str(roid),
        "roleid": str(role_id),
        "rolename": str(role_name),
        "academiccareer": str(academic_career),
        "institution": str(institution),
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://lms.binus.ac.id",
        "Referer": "https://lms.binus.ac.id/",
    }


def load_cached_auth() -> Optional[Dict[str, Any]]:
    """Load cached auth data from disk if valid and not expired."""
    if not CACHE_FILE.exists():
        return None
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        expires_at = data.get("expires_at", 0)
        if expires_at > time.time() + 120:  # 2 minute buffer
            return data
    except Exception as e:
        print(f"[lms_auth] Error loading cache: {e}")
    return None


def save_cached_auth(auth_data: Dict[str, Any]) -> None:
    """Save auth data to disk cache."""
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(auth_data, f, indent=2)
        print(f"[lms_auth] Auth cache saved to {CACHE_FILE}")
    except Exception as e:
        print(f"[lms_auth] Error saving cache: {e}")


def extract_auth_from_driver(driver) -> Optional[Dict[str, Any]]:
    """Extract and decrypt auth from a running Selenium driver."""
    try:
        # Check localStorage persist:lms
        raw_lms = driver.execute_script("return localStorage.getItem('persist:lms');")
        if raw_lms:
            parsed_lms = json.loads(raw_lms)
            if "auth" in parsed_lms:
                auth_cipher = parsed_lms["auth"]
                # In redux-persist-transform-encrypt, auth_cipher might be JSON string
                if auth_cipher.startswith('"') and auth_cipher.endswith('"'):
                    auth_cipher = json.loads(auth_cipher)
                decrypted_json_str = decrypt_cryptojs_aes(auth_cipher, AES_SECRET_KEY)
                decrypted = json.loads(decrypted_json_str)
                if decrypted and decrypted.get("res") and decrypted["res"].get("token"):
                    return decrypted["res"]
    except Exception as e:
        print(f"[lms_auth] Decryption extraction error: {e}")

    # Fallback to store.getState()
    try:
        fiber_res = driver.execute_script("""
            const el = document.querySelector('.app') || document.querySelector('#root') || document.body;
            let fiber = Object.values(el).find(v => v && (v.memoizedProps || v.return));
            let curr = fiber;
            let store = null;
            while (curr) {
                if (curr.memoizedProps && curr.memoizedProps.store) {
                    store = curr.memoizedProps.store;
                    break;
                }
                if (curr.stateNode && curr.stateNode.store) {
                    store = curr.stateNode.store;
                    break;
                }
                curr = curr.return;
            }
            if (store) {
                const s = store.getState();
                if (s.auth && s.auth.res && s.auth.res.token) {
                    return s.auth.res;
                }
            }
            return null;
        """)
        if fiber_res and fiber_res.get("token"):
            return fiber_res
    except Exception:
        pass

    return None


def get_authenticated_session(interactive_if_needed: bool = True) -> Dict[str, Any]:
    """Retrieve valid auth data and headers, using cache, profile extraction, or interactive login."""
    cached = load_cached_auth()
    if cached:
        return cached

    # Try headless extraction
    print("[lms_auth] Checking browser profile for existing session...")
    driver = None
    try:
        driver = create_driver(headless=True)
        driver.get("https://lms.binus.ac.id/lms/dashboard")
        time.sleep(3)

        auth_res = extract_auth_from_driver(driver)
        if auth_res and auth_res.get("token"):
            token = auth_res["token"]
            claims = parse_jwt_payload(token)
            expires_at = claims.get("exp", int(time.time()) + 86400)

            auth_package = {
                "user_id": auth_res.get("id"),
                "name": auth_res.get("name"),
                "token": token,
                "refreshToken": auth_res.get("refreshToken"),
                "expires_at": expires_at,
                "activeRole": auth_res.get("activeRole"),
                "headers": build_headers_from_auth(auth_res),
            }
            save_cached_auth(auth_package)
            return auth_package
    except Exception as e:
        print(f"[lms_auth] Headless check failed: {e}")
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

    if not interactive_if_needed:
        raise RuntimeError("No active session found and interactive login is disabled.")

    # Interactive login
    print("=" * 60)
    print("Binus LMS Login Required")
    print("Opening Chrome for login. Please complete login in the browser.")
    print("=" * 60)

    driver = create_driver(headless=False)
    try:
        driver.get("https://lms.binus.ac.id/lms/dashboard")
        for _ in range(90):  # 3 minutes
            time.sleep(2)
            auth_res = extract_auth_from_driver(driver)
            if auth_res and auth_res.get("token"):
                token = auth_res["token"]
                claims = parse_jwt_payload(token)
                expires_at = claims.get("exp", int(time.time()) + 86400)

                auth_package = {
                    "user_id": auth_res.get("id"),
                    "name": auth_res.get("name"),
                    "token": token,
                    "refreshToken": auth_res.get("refreshToken"),
                    "expires_at": expires_at,
                    "activeRole": auth_res.get("activeRole"),
                    "headers": build_headers_from_auth(auth_res),
                }
                save_cached_auth(auth_package)
                print("[lms_auth] Successfully authenticated and saved token!")
                return auth_package
        raise TimeoutError("Login timed out after 3 minutes.")
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def trigger_interactive_login() -> Dict[str, Any]:
    """Force an interactive browser login to refresh session."""
    # Remove stale cache
    if CACHE_FILE.exists():
        try:
            CACHE_FILE.unlink()
        except Exception:
            pass
    return get_authenticated_session(interactive_if_needed=True)
