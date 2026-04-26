#requires -Version 5.1
$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is not installed or not on PATH."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not installed or not on PATH."
}

Write-Host "Starting backend on http://127.0.0.1:8000 ..."
$backendJob = Start-Job -Name "pm-backend-dev" -ScriptBlock {
    param([string]$RepoRoot)
    Set-Location (Join-Path $RepoRoot "backend")
    uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
} -ArgumentList $RootDir

try {
    Write-Host "Starting frontend on http://localhost:3000 ..."
    Set-Location (Join-Path $RootDir "frontend")
    npm run dev
}
finally {
    if ($backendJob) {
        Stop-Job -Job $backendJob -ErrorAction SilentlyContinue | Out-Null
        Remove-Job -Job $backendJob -Force -ErrorAction SilentlyContinue
    }
}
