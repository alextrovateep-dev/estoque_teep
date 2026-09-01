# Build das imagens api + web para produção (Windows + Docker Desktop).
# Saída: teep-prod-images.tar.gz na raiz do repo.
param(
  [string]$EnvFile = ".env.production",
  [switch]$NoCache
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path $EnvFile)) {
  Write-Error "Arquivo não encontrado: $EnvFile"
}

Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim('"')
  }
}

if (-not $env:NEXT_PUBLIC_API_URL) { throw "defina NEXT_PUBLIC_API_URL em $EnvFile" }
if (-not $env:NEXT_PUBLIC_APP_URL) { throw "defina NEXT_PUBLIC_APP_URL em $EnvFile" }

$cacheArgs = @()
if ($NoCache) {
  $cacheArgs = @("--no-cache")
  Write-Host "==> Modo --no-cache"
}

Write-Host "==> Build api (estoque-teep-api:latest)"
docker build @cacheArgs -f apps/api/Dockerfile -t estoque-teep-api:latest .

Write-Host "==> Build web (estoque-teep-web:latest)"
docker build @cacheArgs -f apps/web/Dockerfile `
  --build-arg "NEXT_PUBLIC_API_URL=$env:NEXT_PUBLIC_API_URL" `
  --build-arg "NEXT_PUBLIC_APP_URL=$env:NEXT_PUBLIC_APP_URL" `
  -t estoque-teep-web:latest .

$Out = Join-Path $Root "teep-prod-images.tar.gz"
Write-Host "==> Export $Out"
docker save estoque-teep-api:latest estoque-teep-web:latest | gzip > $Out
Get-Item $Out | Format-List Name, Length
Write-Host "Pronto. Envie: scp -P 2222 teep-prod-images.tar.gz user@host:/tmp/"
