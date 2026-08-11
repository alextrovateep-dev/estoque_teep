# Script de verificação de status do Estoque TEEP (PowerShell)
# Uso: .\scripts\check-status.ps1

Write-Host "=== Status Estoque TEEP ===" -ForegroundColor Cyan
Write-Host "Data: $(Get-Date)" -ForegroundColor Gray
Write-Host ""

# 1. Verificar se Docker está disponível
try {
    $dockerVersion = docker --version 2>$null
    if ($dockerVersion) {
        Write-Host "✅ Docker encontrado: $dockerVersion" -ForegroundColor Green
    } else {
        Write-Host "❌ Docker não encontrado" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Docker não encontrado" -ForegroundColor Red
    exit 1
}

# 2. Verificar containers
Write-Host "1. Containers:" -ForegroundColor Yellow

$composeFiles = @("docker-compose.prod.yml", "docker-compose.yml")
$foundCompose = $false

foreach ($file in $composeFiles) {
    if (Test-Path $file) {
        Write-Host "  Usando $file:" -ForegroundColor Gray
        try {
            docker-compose -f $file ps 2>$null
            $foundCompose = $true
        } catch {
            try {
                docker compose -f $file ps 2>$null
                $foundCompose = $true
            } catch {
                Write-Host "  ⚠️  Erro ao executar docker compose" -ForegroundColor Yellow
            }
        }
        break
    }
}

if (-not $foundCompose) {
    Write-Host "  ⚠️  Nenhum arquivo docker-compose encontrado" -ForegroundColor Yellow
}

Write-Host ""

# 3. Verificar backups
Write-Host "2. Backups:" -ForegroundColor Yellow

if (Test-Path "backups") {
    $backupDirs = Get-ChildItem "backups" -Directory
    $backupCount = $backupDirs.Count
    
    Write-Host "  Total de backups: $backupCount" -ForegroundColor Gray
    
    if ($backupCount -gt 0) {
        $latestBackup = $backupDirs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        Write-Host "  Último backup: $($latestBackup.Name)" -ForegroundColor Gray
        
        # Verificar integridade básica
        $dbFile = Join-Path $latestBackup.FullName "database.dump"
        if (Test-Path $dbFile) {
            $dbSize = (Get-Item $dbFile).Length / 1MB
            Write-Host "  Tamanho DB: {0:N2} MB" -f $dbSize -ForegroundColor Gray
        }
        
        $uploadsFile = Join-Path $latestBackup.FullName "uploads.tar.gz"
        if (Test-Path $uploadsFile) {
            $uploadsSize = (Get-Item $uploadsFile).Length / 1MB
            Write-Host "  Tamanho uploads: {0:N2} MB" -f $uploadsSize -ForegroundColor Gray
        }
    } else {
        Write-Host "  ⚠️  Nenhum backup encontrado" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⚠️  Diretório backups não encontrado" -ForegroundColor Yellow
}

Write-Host ""

# 4. Verificar logs recentes
Write-Host "3. Logs recentes (últimas 24h):" -ForegroundColor Yellow

foreach ($composeFile in $composeFiles) {
    if (Test-Path $composeFile) {
        Write-Host "  Verificando $composeFile..." -ForegroundColor Gray
        try {
            $logs = docker-compose -f $composeFile logs --since=24h api 2>$null
            if ($logs) {
                $errorLogs = $logs | Select-String -Pattern "error|fail|exception|warn" -CaseSensitive:$false
                if ($errorLogs) {
                    Write-Host "  ⚠️  Erros encontrados:" -ForegroundColor Red
                    $errorLogs | Select-Object -Last 5 | ForEach-Object {
                        Write-Host "    $_" -ForegroundColor Red
                    }
                } else {
                    Write-Host "  ✅ Nenhum erro encontrado" -ForegroundColor Green
                }
            }
            break
        } catch {
            # Ignorar erro
        }
    }
}

Write-Host ""

# 5. Verificar espaço em disco
Write-Host "4. Espaço em disco:" -ForegroundColor Yellow
$diskInfo = Get-PSDrive -Name (Get-Location).Drive.Name
$freeGB = [math]::Round($diskInfo.Free / 1GB, 2)
$totalGB = [math]::Round($diskInfo.Used / 1GB + $diskInfo.Free / 1GB, 2)
$percentUsed = [math]::Round(($diskInfo.Used / ($diskInfo.Used + $diskInfo.Free)) * 100, 2)
Write-Host "  Disponível: ${freeGB}GB de ${totalGB}GB ($percentUsed% usado)" -ForegroundColor Gray

Write-Host ""

# 6. Verificar saúde da API
Write-Host "5. Health Check da API:" -ForegroundColor Yellow

$apiUrl = "http://localhost:4000"

# Tentar obter URL do .env
$envFiles = @(".env.production", "apps/web/.env.local")
foreach ($envFile in $envFiles) {
    if (Test-Path $envFile) {
        $content = Get-Content $envFile -Raw
        if ($content -match "NEXT_PUBLIC_API_URL\s*=\s*(.+)") {
            $apiUrl = $matches[1].Trim().Trim('"').Trim("'")
            break
        }
    }
}

try {
    $response = Invoke-WebRequest -Uri "$apiUrl/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "  ✅ API respondendo em $apiUrl" -ForegroundColor Green
    
    try {
        $healthJson = $response.Content | ConvertFrom-Json
        Write-Host "  Health: $($healthJson | ConvertTo-Json -Compress)" -ForegroundColor Gray
    } catch {
        Write-Host "  Health: $($response.Content)" -ForegroundColor Gray
    }
    
    # Tentar ready check
    try {
        $readyResponse = Invoke-WebRequest -Uri "$apiUrl/ready" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($readyResponse.StatusCode -eq 200) {
            $readyJson = $readyResponse.Content | ConvertFrom-Json
            Write-Host "  Ready: $($readyJson.status)" -ForegroundColor Gray
        }
    } catch {
        # Ignorar erro no ready check
    }
} catch {
    Write-Host "  ⚠️  API não respondendo em $apiUrl" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Verificação concluída ===" -ForegroundColor Cyan