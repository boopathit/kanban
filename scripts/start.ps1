#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RootDir

if (-not (Test-Path .env)) {
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
        Write-Host "Created .env from .env.example. Edit it to set your secrets."
    } else {
        Write-Error "Missing .env and .env.example; cannot continue."
    }
}

Write-Host "Building and starting pm-mvp..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Waiting for /api/health..."
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) {
            Write-Host "Healthy. App is at http://localhost:8000/"
            exit 0
        }
    } catch {
        # not ready yet
    }
    Start-Sleep -Seconds 1
}

Write-Host "Health check did not pass within 30s. Recent logs:" -ForegroundColor Yellow
docker compose logs --tail=80 app
exit 1
