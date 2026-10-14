#!/usr/bin/env python3
"""Mint a Coach session cookie from .secrets/session_secret (same format as middleware.js), for --verify and audits.
Prints only 'coach_session=<token>' (a session token, not the password)."""
import base64, hashlib, hmac, os, time
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
secret = open(os.path.join(here, ".secrets", "session_secret")).read().strip()
exp = int(time.time()) + 3600
sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"v1.{exp}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
print(f"coach_session=v1.{exp}.{sig}")
