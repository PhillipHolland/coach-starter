#!/usr/bin/env python3
"""Sync the configured wearable into data.json -> wear (normalized; see common.py).

Usage: python3 wearables/sync.py [--days 30] [--all] [--quiet] [--source whoop|oura|fitbit|none]
The source defaults to data.json config.wearable. Exit 0 on success or when there is nothing to sync, 1 on failure.
Never prints tokens or client secrets.
"""
import argparse, fcntl, importlib, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import KIT, WearableError, load_data, merge   # noqa: E402

ADAPTERS = ("whoop", "oura", "fitbit", "none")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30); ap.add_argument("--all", action="store_true")
    ap.add_argument("--quiet", action="store_true"); ap.add_argument("--source", choices=ADAPTERS)
    a = ap.parse_args()
    src = a.source or (load_data().get("config") or {}).get("wearable", "none")
    if src not in ADAPTERS: sys.exit(f"unknown wearable '{src}'")
    if src == "none":
        print("wearable = none: nothing to sync (use log.py checkin)"); return
    lock = open(os.path.join(KIT, ".sync.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)   # one sync at a time: refresh tokens are single-use
    except BlockingIOError:
        sys.exit("a sync is already running")
    mod = importlib.import_module(src)
    try:
        have = len((load_data().get("wear") or {}).get("days") or {})
        days, profile = mod.fetch(a.days, full=a.all or have < 30)
        w = merge(src, days, profile)
    except (WearableError, OSError, KeyError, ValueError) as ex:
        print(f"{src} sync failed: {type(ex).__name__}: {ex}", file=sys.stderr); sys.exit(1)
    except Exception as ex:   # requests errors etc.
        print(f"{src} sync failed: {type(ex).__name__}", file=sys.stderr); sys.exit(1)
    print(f"{src}: synced {len(days)} days ({len(w['days'])} stored) at {w['synced_at']}")


if __name__ == "__main__":
    main()
