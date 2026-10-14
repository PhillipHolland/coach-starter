"""No wearable: nothing to sync. The app shows a manual morning check-in (log.py checkin --sleep 7.5 --energy 4 --soreness 2)
instead of rings, stored in data.json -> journal (sleep_hours, energy, soreness)."""
NAME = "none"


def fetch(days=30, full=False):
    return {}, {}
