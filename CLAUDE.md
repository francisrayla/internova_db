# Internova (capstone)

Laravel API in `backend/`, Next.js app in `frontend/`. Deployed on Railway.

## Read less: use the feature logs first
- Before reading source for a feature, read `.claude/feature-logs/INDEX.md`, then only that feature's `<slug>.md` (map of files, line ranges, how it works, how to test).
- Run `bash .claude/feature-logs/changed.sh <slug>` to see which mapped files changed since the log was written. Read only those diffs. Trust the log for the rest.
- For testing, fixing or changing a single feature, prefer delegating to the `kyo` agent (Sonnet, follows the same log workflow).
- If you change a feature in the main session, update its log before finishing: `last_commit`, Map line ranges, and one History line (keep the last 5).
- A feature with no log yet: explore once, then create its log and add it to the INDEX.

## Run locally (Windows, Git Bash)
- MySQL (XAMPP): `cd /c/xampp/mysql && bin/mysqld.exe --defaults-file=bin/my.ini --standalone` (background)
- Backend: `cd backend && php artisan serve` (:8000), `php artisan reverb:start` (:8080), `php artisan queue:listen --timeout=0` (mail and jobs; without --timeout=0 it exits after the laptop sleeps)
- Frontend: `cd frontend && npm run dev` (:3000). The service worker is off in dev (it would serve stale scripts); test offline mode with `npm run build && npm start`.
- Tests: `cd backend && php artisan test` (MySQL database `internova_testing`, which RefreshDatabase wipes on every run; never point tests at `internova_db`); frontend `npm run lint` / `npm run build`
- Before starting a server, check whether the port is already in use. If an orphaned `next start` holds :3000, kill only that PID.

## Deploy (Railway project "internova", production). Only when the user says so.
- `railway up ./frontend --path-as-root --service frontend --detach -m "<msg>"`
- `railway up ./backend --path-as-root --service <backend|queue|reverb> --detach -m "<msg>"` (backend runs migrations on deploy)
- Check with Railway MCP `get-logs`; `railway ssh` for `php artisan migrate:status`.

## Standing rules
- Never alter or delete the real Super Admin account (francisrayla12345@gmail.com).
- Ask before emailing real people, before destructive DB operations and before each production deploy.
- Clean up test data you create. Never print secrets (.env values, API keys) into the chat.
- If a safety check blocks an action, stop and tell the user. Do not work around it.
- Reply to the user in Taglish.
