# Scripts

Start/stop the full Docker stack for local development. Bash for macOS/Linux, PowerShell for Windows. The behavior is identical across both.

## Files

| File | OS | Purpose |
|------|----|---------|
| `start.sh` / `start.ps1` | Linux+macOS / Windows | Build + start the container, then poll `/api/health` for up to 30 s |
| `stop.sh` / `stop.ps1` | Linux+macOS / Windows | `docker compose down` |

## Usage

macOS / Linux:

```bash
./scripts/start.sh
./scripts/stop.sh
```

Windows (PowerShell):

```powershell
.\scripts\start.ps1
.\scripts\stop.ps1
```

## What `start` does

1. `cd` to the repo root (resolved from the script's own location).
2. If `.env` is missing, copy `.env.example` to `.env` and tell the user to edit it.
3. `docker compose up -d --build`.
4. Poll `http://localhost:8000/api/health` once per second for 30 s. On success, print the URL and exit 0. On timeout, dump the last 80 lines of `app` logs and exit 1.

## Requirements

- Docker Desktop (Mac/Windows) or Docker Engine + Compose v2 (Linux).
- For `start.sh`: `bash`, `curl`. For `start.ps1`: PowerShell 5.1+.
- The repo's `.env` file with `SESSION_SECRET` and (later) `OPENROUTER_API_KEY` set.

## Adding a new script

If a new dev workflow needs its own script (e.g. `seed.sh` to wipe the SQLite file), put it here, follow the same pattern (resolve `ROOT_DIR`, fail loudly), and document it in this file.
