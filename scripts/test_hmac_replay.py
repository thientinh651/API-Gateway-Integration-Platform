#!/usr/bin/env python3
"""Test HMAC + replay: lần 2 cùng signature phải 401 replay_detected."""
import hashlib
import hmac
import os
import sys
import time

try:
    import requests
except ImportError:
    print("pip install requests")
    sys.exit(1)

API_KEY = os.environ.get("API_KEY", "").strip()
SECRET = os.environ.get("SECRET_KEY", "").strip()
BASE = os.environ.get("GATEWAY_BASE", "https://thientinh.io.vn").rstrip("/")
PATH = os.environ.get("PATH_SIGN", "/v1/api/get")
METHOD = os.environ.get("METHOD", "GET").upper()

if not API_KEY or not SECRET:
    print("Set API_KEY and SECRET_KEY (avaso_pk_ / avaso_sk_)")
    sys.exit(1)


def sign_and_send(ts: str) -> int:
    body = ""
    payload = f"{API_KEY}\n{ts}\n{METHOD}\n{PATH}\n{body}"
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    r = requests.request(
        METHOD,
        f"{BASE}{PATH}",
        headers={
            "X-API-Key": API_KEY,
            "X-Timestamp": ts,
            "X-Signature": sig,
        },
        timeout=30,
    )
    print(f"  HTTP {r.status_code} — {r.text[:200]}")
    return r.status_code, r.text


def main() -> None:
    ts = str(int(time.time()))
    print(f"1) First request (ts={ts})")
    s1, t1 = sign_and_send(ts)
    print("2) Replay same signature")
    s2, t2 = sign_and_send(ts)
    print("\nSummary:")
    print(f"  first:  {s1}")
    print(f"  replay: {s2} (expect 401)")
    if s1 in (200, 404) and s2 == 401 and "replay" in t2.lower():
        print("OK — replay blocked")
    else:
        print("Check route/upstream or keys")


if __name__ == "__main__":
    main()
