#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RootDir

docker compose down
Write-Host "Stopped."
