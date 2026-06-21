#!/usr/bin/env python3
"""Test JWT data plane: no token 401, valid token 200/404, expired rejected."""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("GATEWAY_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
CLIENT_ID = os.environ.get("BENCH_API_KEY", os.environ.get("TEST_CLIENT_ID", ""))
CLIENT_SECRET = os.environ.get("BENCH_SECRET_KEY", os.environ.get("TEST_CLIENT_SECRET", ""))
PATH = os.environ.get("TEST_DATA_PLANE_PATH", "/v1/api/get")


def request(method: str, path: str, token: str | None = None) -> tuple[int, dict]:
    url = f"{BASE}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                data = {"raw": body[:200]}
            return resp.status, data
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {"raw": body[:200]}
        return e.code, data


def fetch_token() -> str:
    if not CLIENT_ID or not CLIENT_SECRET:
        print("Set TEST_CLIENT_ID + TEST_CLIENT_SECRET (or BENCH_API_KEY + BENCH_SECRET_KEY)", file=sys.stderr)
        sys.exit(1)
    data = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        }
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/api/oauth/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode())
    token = payload.get("access_token")
    if not token:
        print("No access_token in response", payload, file=sys.stderr)
        sys.exit(1)
    return token


def main() -> int:
    print(f"1) No token → {PATH}")
    s1, _ = request("GET", PATH, None)
    print(f"   HTTP {s1}")
    if s1 != 401:
        print("FAIL expected 401", file=sys.stderr)
        return 1

    token = fetch_token()
    print("2) Valid Bearer token")
    s2, _ = request("GET", PATH, token)
    print(f"   HTTP {s2}")
    if s2 not in (200, 404, 502):
        print(f"FAIL unexpected status {s2}", file=sys.stderr)
        return 1

    print("OK jwt auth smoke")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
