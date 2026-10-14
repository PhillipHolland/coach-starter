"""Parse free-text workout notes into structured exercises. Never invents data: anything that does not
match a known shape is kept as a plain-text row ({"name": text, "text": True})."""
import re

SEP = re.compile(r"\s*(?:\u00b7|•|;|\n|\|)\s*")
WEIGHT = r"(?P<w>\d+(?:\.\d+)?)\s*(?P<u>lbs?|kg|s)\b"
SETS_X = r"(?P<n>\d+)\s*[x×]\s*(?P<r>\d+(?:-\d+)?)"
SETS_SL = r"(?P<sl>\d+(?:-\d+)?(?:\s*/\s*\d+(?:-\d+)?)*)"
NOTE_PAREN = re.compile(r"\s*\(([^)]*)\)\s*")
EX_RE = re.compile(rf"^(?P<name>.+?)(?:\s+{WEIGHT})?\s+(?:{SETS_X}|{SETS_SL})(?P<rest>(?:\s+.*)?)$", re.I)
NO_SAUNA = re.compile(r"^no sauna\.?$", re.I)
SAUNA = re.compile(r"^(?:sauna(?:\s+\d+\s*min)?|did sauna)\.?$", re.I)


def _key(name): return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def _parts(note):
    for seg in SEP.split(note or ""):
        # a trailing sentence like ". No sauna." becomes its own part
        for s in re.split(r"(?<=[a-z0-9)])\.\s+(?=[A-Z])", seg):
            s = s.strip().rstrip(".").strip()
            if s: yield s


def parse_one(p, unit="lb"):
    notes = []
    def grab(m): notes.append(m.group(1).strip()); return " "
    q = NOTE_PAREN.sub(grab, p).strip()
    q = re.sub(r"\s+", " ", q)
    m = EX_RE.match(q)
    if not m: return {"name": p, "text": True, "raw": p}
    name = m["name"].strip()
    if re.search(r"\d", name) and re.search(r"\d+\s*(?:lb|kg|s)\b", name, re.I):
        return {"name": p, "text": True, "raw": p}
    if m["n"]: sets = [m["r"]] * int(m["n"])
    else: sets = [s.strip() for s in m["sl"].split("/")]
    sets = [int(s) if s.isdigit() else s for s in sets]
    rest = (m["rest"] or "").strip()
    if rest: notes.append(rest)
    u = (m["u"] or "").lower()
    w = float(m["w"]) if m["w"] else None
    return {"name": name[0].upper() + name[1:], "key": _key(name), "weight": w,
            "unit": None if w is None else ("kg" if u == "kg" else "lb" if u.startswith("lb") else unit), "per_hand": u == "s",
            "sets": sets, "note": "; ".join(n for n in notes if n) or None, "raw": p}


def parse_note(note, unit="lb"):
    """-> (exercises, flags). flags may contain sauna: True/False when the note says so."""
    ex, flags = [], {}
    for p in _parts(note):
        if NO_SAUNA.match(p): flags["sauna"] = False; continue
        if SAUNA.match(p): flags["sauna"] = True; continue
        ex.append(parse_one(p, unit))
    return ex, flags


def enrich(w, unit="lb"):
    """unit = the user's default (coach.config.json units) for bare numbers like '25s' (per hand)."""
    w = dict(w)
    ex, flags = parse_note(w.get("note"), unit)
    w["exercises"] = ex
    for k, v in flags.items(): w.setdefault(k, v)
    return w
