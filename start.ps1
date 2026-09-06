$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $PSCommandPath
$BackendPort = 11056
$FrontendPort = 11057

# Clear port zombies
Get-NetTCPConnection -LocalPort $BackendPort -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort $FrontendPort -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host "=== Giskard Red-Team Node ===" -ForegroundColor Cyan
Write-Host "Backend:  http://127.0.0.1:${BackendPort}" -ForegroundColor Yellow
Write-Host "Frontend: http://127.0.0.1:${FrontendPort}" -ForegroundColor Yellow

# Start backend
$BackendJob = Start-Job -Name "giskard-backend" -ScriptBlock {
    param($Root, $Port)
    Set-Location $Root
    $env:GISKARD_MCP_PORT = $Port
    uv run python -m giskard_mcp --serve
} -ArgumentList $ScriptRoot, $BackendPort

# Wait for backend health
Write-Host "Waiting for backend..." -ForegroundColor Gray
for ($i = 0; $i -lt 60; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:${BackendPort}/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { Write-Host "Backend ready" -ForegroundColor Green; break }
    } catch {}
    Start-Sleep 1
}

# Start frontend
$FrontendDir = Join-Path $ScriptRoot "webapp" "frontend"
if (Test-Path "$FrontendDir\package.json") {
    Write-Host "Starting frontend..." -ForegroundColor Gray
    Push-Location $FrontendDir
    if (-not (Test-Path "node_modules\.package-lock.json")) {
        & "C:\Users\sandr\.local\bin\bun.exe" install --silent 2>$null
    }
    $null = Start-Process -NoNewWindow -FilePath "C:\Users\sandr\.local\bin\bun.exe" -ArgumentList "run dev --port $FrontendPort --host" -WorkingDirectory $FrontendDir
    Pop-Location
}

Start-Process "http://127.0.0.1:${FrontendPort}"

# Keep-alive
while ($true) {
    if ($BackendJob.State -eq "Completed" -or $BackendJob.State -eq "Failed") {
        Receive-Job $BackendJob
        break
    }
    Start-Sleep 2
}
