$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Name = "giskard-mcp"
$Version = "0.1.0"
$DistDir = "$Root\dist"
$MCPBDir = "$Root\mcpb"

New-Item -ItemType Directory -Force -Path $MCPBDir, $DistDir | Out-Null

Write-Host "=== Building ${Name} MCPB Bundle ===" -ForegroundColor Cyan

# Sync src/
Write-Host "-> Syncing src/..." -ForegroundColor Yellow
Remove-Item -Recurse -Force "$MCPBDir\src" -ErrorAction SilentlyContinue
Copy-Item -Recurse "$Root\src" "$MCPBDir\src"

# Sync assets/
Write-Host "-> Syncing assets/..." -ForegroundColor Yellow
Remove-Item -Recurse -Force "$MCPBDir\assets" -ErrorAction SilentlyContinue
Copy-Item -Recurse "$Root\assets" "$MCPBDir\assets"

# Sync manifest.json
Write-Host "-> Copying manifest.json..." -ForegroundColor Yellow
Copy-Item "$Root\manifest.json" "$MCPBDir\manifest.json" -Force

# Sync README
Copy-Item "$Root\README.md" "$MCPBDir\README.md" -Force

# Pack
Write-Host "-> Packing..." -ForegroundColor Yellow
$Output = "$DistDir\${Name}-v${Version}.mcpb"
if (Get-Command bunx -ErrorAction SilentlyContinue) {
    bunx @anthropic-ai/mcpb pack $MCPBDir $Output 2>&1
} else {
    npx --yes @anthropic-ai/mcpb pack $MCPBDir $Output 2>&1
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "  Bundle: $Output" -ForegroundColor Green
    Write-Host "  Size: $((Get-Item $Output).Length / 1KB) KB" -ForegroundColor Green
} else {
    Write-Host "  MCPB pack failed" -ForegroundColor Red
}

# Cleanup mcpb staging dir
Remove-Item -Recurse -Force $MCPBDir -ErrorAction SilentlyContinue

Write-Host "=== Done ===" -ForegroundColor Green
