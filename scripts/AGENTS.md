# Scripts

Scripts for both Docker runtime and hot-reload local development. Bash for macOS/Linux, PowerShell for Windows.

## Files

| File | OS | Purpose |
|------|----|---------|
| `start.sh` / `start.ps1` | Linux+macOS / Windows | Build + start the container, then poll `/api/health` for up to 30 s |
| `stop.sh` / `stop.ps1` | Linux+macOS / Windows | `docker compose down` |
| `dev.sh` / `dev.ps1` | Linux+macOS / Windows | Start backend (`uvicorn --reload`) and frontend (`next dev`) together |

## Usage

macOS / Linux:

```bash
./scripts/start.sh
./scripts/stop.sh
./scripts/dev.sh
```

Windows (PowerShell):

```powershell
.\scripts\start.ps1
.\scripts\stop.ps1
.\scripts\dev.ps1
```

`dev` runs both processes in one command:

- backend: `http://127.0.0.1:8000` (`uv run uvicorn app.main:app --reload`)
- frontend: `http://localhost:3000` (`npm run dev`, using Next dev rewrite for `/api/*`)
- stop by pressing `Ctrl+C` in the same terminal.

## What `start` does

1. `cd` to the repo root (resolved from the script's own location).
2. If `.env` is missing, copy `.env.example` to `.env` and tell the user to edit it.
3. `docker compose up -d --build`.
4. Poll `http://localhost:8000/api/health` once per second for 30 s. On success, print the URL and exit 0. On timeout, dump the last 80 lines of `app` logs and exit 1.

## Requirements

- Docker Desktop (Mac/Windows) or Docker Engine + Compose v2 (Linux) for container mode.
- For `start.sh`/`dev.sh`: `bash` (and `curl` for `start.sh`).
- For `start.ps1`/`dev.ps1`: PowerShell 5.1+.
- For `dev`: `uv` (Python tooling) and `npm` installed locally.
- The repo's `.env` file with `SESSION_SECRET` and (later) `OPENROUTER_API_KEY` set.

## Adding a new script

If a new dev workflow needs its own script (e.g. `seed.sh` to wipe the SQLite file), put it here, follow the same pattern (resolve `ROOT_DIR`, fail loudly), and document it in this file.
