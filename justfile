set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

_default:
    @just --list

# -- Dependencies --
sync:
    uv sync

sync-dev:
    uv sync --all-extras

# -- Lint & quality --
lint:
    uv run ruff check src/
    uv run ruff format --check src/

fix:
    uv run ruff check --fix src/
    uv run ruff format src/

fmt:
    uv run ruff format src/

check:
    @just lint
    @just test

# -- MCP server --
mcp:
    uv run python -m giskard_mcp --stdio

mcp-http:
    uv run python -m giskard_mcp --serve

# -- Testing --
test:
    uv run pytest tests/ -v

# -- Docker --
docker-build:
    docker build -t giskard-mcp .

docker-run:
    docker run --rm -it giskard-mcp

docker-up:
    docker compose up --build -d

docker-down:
    docker compose down

# ===== Webapp =====

# Install frontend deps
webapp-install:
    cd webapp/frontend; bun install

# Start Vite dev server (frontend only)
webapp-dev:
    cd webapp/frontend; bun run dev

# Build frontend for production
webapp-build:
    cd webapp/frontend; bun run build

# Start full stack (backend + frontend)
serve:
    powershell.exe -NoProfile -File start.ps1

# Run Playwright e2e tests
e2e:
    cd webapp/frontend; npx playwright test

# ===== Packaging =====

# Build MCPB bundle for Claude Desktop
mcpb-pack:
    powershell.exe -NoProfile -File scripts/build-mcpb-package.ps1

# Build the PyInstaller backend .exe and copy to Tauri resources
build-sidecar:
    powershell.exe -NoProfile -File '{{justfile_directory()}}\native\build.ps1'

# Build the Tauri NSIS desktop installer (full pipeline: frontend -> PyInstaller -> Rust -> NSIS)
build-native:
    Set-Location '{{justfile_directory()}}\native'; $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; .\build.ps1

# Build Tauri native app (debug, skip PyInstaller)
build-native-debug:
    Set-Location '{{justfile_directory()}}\native'; $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; npx @tauri-apps/cli build --debug

# Run CUA-NSIS smoke test (install -> launch -> verify -> uninstall)
cua-nsis-test:
    uv run python scripts/cua-smoke.py

# Generate icons for MCPB and Tauri
icons:
    uv run python scripts/make_icon.py

# Update D:\Dev\Tauri starts shortcut to latest NSIS installer
update-link:
    powershell.exe -NoProfile -File scripts/update-tauri-starts-link.ps1

# Bootstrap: install dev deps + pre-commit hook
bootstrap:
    uv sync --group dev
    uv run pre-commit install
    Write-Host "Pre-commit hooks installed." -ForegroundColor Green