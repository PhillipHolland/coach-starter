#!/usr/bin/env python3
"""Serve dist/ locally with the same headers as dist/vercel.json (incl. CSP), for audits. Usage: serve.py [port]"""
import http.server, json, os, sys
DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
HDRS = [(h["key"], h["value"]) for r in json.load(open(os.path.join(DIST, "vercel.json")))["headers"] for h in r["headers"]]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=DIST, **k)
    def end_headers(self):
        for k, v in HDRS: self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8766), H).serve_forever()
