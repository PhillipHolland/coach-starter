# Coach starter kit — operator guide (for a bot)

A private, password-gated fitness dashboard (static PWA + Vercel middleware). Data lives in `data.json`, gets logged with `log.py`, is built by `build.py`, and ships with `publish.sh`.
Rules: never print secrets, never commit `.secrets/`, and never invent wearable data.

## 1. Configure
Edit `coach.config.json`. These keys are validated:
- `site_title`, `brand`: display names.
- `profile`: `name` (optional), `timezone` (IANA), `units` (`lb`|`kg`), `birth_date` (optional, YYYY-MM-DD; needed for Coach Age), `goal_weight`.
- `targets`: `kcal`, `protein`, `steps`.
- `split`: rotation list, e.g. `["PUSH","PULL","LEGS"]`.
- `supplements`: `[{name, dose, aliases[]}]`.
- `theme`: `recovery` | `glass` | `light`. The user can override it in More > Appearance; that choice is saved per device.
- `wearable`: `whoop` | `oura` | `fitbit` | `none`.
- `features.pullups`: bool.

## 2. Setup (non-interactive)
    python3 setup.py --config coach.config.json   # validates, then writes/merges data.json (existing logs are kept)
    python3 setup.py --validate                   # re-validates data.json
Exit code 2 means invalid input, with `ERROR:` lines saying what's wrong. setup.py also prints the env vars the chosen wearable needs.

## 3. Secrets (collect each one with a secure form, never in chat)
Vercel project env vars:
| var | when | note |
|---|---|---|
| COACH_PASSWORD | always | login password (the username is `coach`) |
| COACH_SESSION_SECRET | always | random 32+ bytes. Also save it to `.secrets/session_secret` (chmod 600) so `--verify` works |
| SYNC_SHARED_SECRET | whoop | also save to `.secrets/sync_secret` |
| BLOB_READ_WRITE_TOKEN | whoop | Vercel Blob store that holds the rotating refresh token |
| WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET | whoop | OAuth app |
| WHOOP_REFRESH_TOKEN_SEED | whoop | the first refresh token, from `wearables/connect.py` |
| COACH_URL / COACH_PROJECT | optional | used by publish.sh when `deploy.json` is missing |

On the box, put `.secrets/wearable.env` (chmod 600) in KEY=VALUE form: `<SRC>_CLIENT_ID`, `<SRC>_CLIENT_SECRET` (SRC = WHOOP|OURA|FITBIT).
For OAuth, set the redirect URI to `http://localhost:8765/callback`.

## 4. Connect + sync a wearable (skip if `none`)
    python3 wearables/connect.py      # prints the auth URL; tokens go to .secrets/<src>_tokens.json
    python3 wearables/sync.py         # pulls ~30 days into data.json "wear" (locked, idempotent)
Status:
- whoop: tested, including the live refresh in `api/refresh.js`.
- oura (API v2) and fitbit: tested against mocks only (`tools/test_adapters.py`). Validate them on a real account first.
- Fitbit has no readiness score. The app shows an ESTIMATE from HRV and resting HR (needs 14+ days) and labels it with `*`.
- `none`: rings are hidden and a manual check-in card appears instead: `log.py checkin --sleep 7 --energy 3 --soreness 2`.
- Live in-app refresh exists only for WHOOP. The others update when sync.py + publish run.

## 5. Publish
    ./publish.sh                 # sync (SKIP_SYNC=1 skips it), validate, build, write deploy-payload.json
Deploy `deploy-payload.json` with the Vercel connector `create_deployment` (target production, requestBody `$file:<abs path>`).
Before deploying, `list_deployments` must show nothing BUILDING or QUEUED. Poll until READY.
On the first deploy, write `deploy.json` = `{"project":"<name>","url":"https://<prod-domain>"}`. Then:
    ./publish.sh --mark-deployed && ./publish.sh --verify
A passing `--verify` means login works and the data on the site matches.

## 6. Log
    python3 log.py --help
    weight 182.4 | food --cal 300 --protein 25 --note "eggs" | workout PULL --note "pull-ups 3x5; row 60lb 10,10,8" | supp creatine | journal alcohol 0 | checkin ...
Republish after logging.

### Meal photos
When the user sends a photo of a meal for nutrition analysis:
1. Save the image file on the box (chat attachments already land as files; note the absolute path). Don't copy it into the repo.
2. Estimate calories, protein, fat, carbs and sugar from the photo plus anything the user said. Say they are estimates; never invent precision.
3. Give a Macro Score 1-10 (protein density and fit to the targets) and one concrete swap tip.
4. Log it with the photo:

       python3 log.py food --cal 620 --protein 45 --fat 22 --carbs 55 --sugar 8 --note "Chicken rice bowl (estimate)" \
                           --photo /abs/path/meal.jpg --score 8 --tip "Half the rice, add greens"

   If the meal is already logged, attach the photo instead of logging a duplicate:
   `python3 log.py meal-photo /abs/path/meal.jpg [--date YYYY-MM-DD] [--match "rice"|--entry N] --score 8 --tip "..."`.
5. Republish (section 5).

log.py resizes to 800 px on the long edge (plus a 160 px thumbnail), re-encodes JPEG at quality 70 and drops EXIF/GPS. Files go to `meals/`, which is git-ignored, and ship as `dist/m/<random id>.jpg` behind the same password gate as `data.json` (`--verify` checks that an anonymous request is blocked). A photo is ~50-80 KB and uploads once; after `--mark-deployed` later deploys reference it by SHA. `log.py undo food` deletes the photo too.
In the app, a meal with a photo shows a thumbnail in the meal journal. Tapping it opens a full-screen viewer: swipe down or tap outside to close, pinch or double-tap to zoom. Tapping the row opens the meal sheet with macros, score and tip.

## 7. Test
    python3 tools/test_adapters.py
    PUPPETEER=<puppeteer-core path> python3 tools/test_matrix.py   # 3 themes x 4 wearables, synthetic data in temp dirs; screenshots in shots/
