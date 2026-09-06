# Build Log — giskard-mcp

## Quick Build Recipe

```powershell
# 0. Prerequisites
#    - Rust toolchain: rustup(default)
#    - MSVC Build Tools: VS 2022 Community at C:\Program Files\Microsoft Visual Studio\2022\Community
#    - Tauri CLI: npx @tauri-apps/cli (v2.11+)
#    - uv sync --all-extras (includes pyinstaller in venv)

# 1. Activate MSVC environment (required before ANY cargo/Tauri command)
$vcvars = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
$envOutput = cmd /c "`"$vcvars`" > nul & set" |
    Where-Object { $_ -match '^(INCLUDE|LIB|LIBPATH|PATH|VCToolsVersion|WindowsSdkDir|UniversalCRTSdkDir|UCRTVersion)=' }
foreach ($line in $envOutput) {
    $parts = $line.Split('=', 2)
    [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
}
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

# 2. Patch fastmcp metadata fallback (required before PyInstaller)
$fm = ".venv\Lib\site-packages\fastmcp\__init__.py"
$c = Get-Content $fm -Raw
$c = $c -replace 'except PackageNotFoundError:\s+    __version__ = _version\("fastmcp"\)',
    'except PackageNotFoundError: try: __version__ = _version("fastmcp") except PackageNotFoundError: __version__ = "0.0.0"'
Set-Content $fm -Value $c -Encoding utf8

# 3. Frontend build
cd webapp/frontend
npm install
npx tsc --noEmit
npm run build
cd ..\..

# 4. PyInstaller (must run from venv, NOT global tool)
uv run pyinstaller giskard-mcp-backend.spec --noconfirm

# 5. Copy backend to Tauri resources
Copy-Item "dist\giskard-mcp-backend.exe" "native\resources\" -Force
Copy-Item "dist\giskard-mcp-backend.exe" "native\binaries\giskard-mcp-backend-x86_64-pc-windows-msvc.exe" -Force

# 6. Tauri NSIS build (from native/)
cd native
npx @tauri-apps/cli build --bundles nsis
cd ..

# 7. Clean stale shadow exe (fools backend.rs resolution)
Remove-Item -Force "native\src-tauri\target\release\giskard-mcp-backend.exe" -ErrorAction SilentlyContinue

# 8. Stage installer
Copy-Item "native\src-tauri\target\release\bundle\nsis\Giskard Red-Team Node_*_x64-setup.exe" "dist\" -Force

# 9. MCPB bundle (optional, for Claude Desktop)
npx @anthropic-ai/mcpb pack . dist/giskard-mcp-v0.1.0.mcpb
```

**Ship:** `dist\Giskard Red-Team Node_0.1.0_x64-setup.exe` (one NSIS installer, ~13 MB)

---

## Build History

### 2026-06-23 — First build

| Step | Issue | Fix |
|------|-------|-----|
| Frontend | Clean | — |
| PyInstaller | `ModuleNotFoundError: No module named 'mcp'` | `mcp` package not in hiddenimports in spec. Spec had wrong deps. |
| PyInstaller | `PackageNotFoundError: No package metadata was found for fastmcp` | `copy_metadata('fastmcp')` can't find metadata when PyInstaller runs from uv tool (global), not venv. Fix: remove `copy_metadata` calls from spec, use simple hiddenimports list. |
| PyInstaller | `PermissionError: Access is denied` | Stale backend.exe process from previous test still running. Fix: `Stop-Process giskard-mcp-backend` before rebuild. |
| PyInstaller | Build timeout (3+ min) | `collect_submodules('giskard')` traverses giskard's entire dep tree (numba, torch, etc.) and hangs. Fix: use explicit hiddenimports list, not collect_submodules. |
| PyInstaller | `console=False` → uvicorn crashes | uvicorn needs stderr. `console=False` makes sys.stderr = None. Fix: `console=True` in spec. Tauri spawns with CREATE_NO_WINDOW so no console window appears anyway. |
| Tauri build | Can't find web assets | `frontendDist` path is relative to `src-tauri/`, not `native/`. Fix: `"../../webapp/frontend/dist"`. |
| Tauri build | Resource path wrong | `"resources/giskard-mcp-backend.exe"` resolves to `src-tauri/resources/` but file is at `native/resources/`. Fix: `"../resources/giskard-mcp-backend.exe"`. |
| Tauri build | Hooks path wrong | `"./windows/hooks.nsh"` resolves to `src-tauri/windows/` but file is at `native/windows/`. Fix: `"../windows/hooks.nsh"`. |
| Tauri build | `resource path doesn't exist` | Despite file being present, path resolution failed. Fixed by changing resources path to `"../resources/..."`. |
| Backend smoke | Port never opens | `console=False` made uvicorn crash silently. Fixed by `console=True` + proper hiddenimports. |

### Key Lessons

1. **PyInstaller must be in the venv**, not a global uv tool — `uv run pyinstaller` picks the global tool first if installed there. Add `pyinstaller>=6.0.0` to `pyproject.toml [dependency-groups] dev`.
2. **Never use `collect_submodules` on giskard** — it hangs for minutes traversing ML deps. Use explicit hiddenimports.
3. **`tauri.conf.json` paths are relative to `src-tauri/`** — `frontendDist`, `resources`, and `installerHooks` all resolve from `src-tauri/`, not from `native/`.
4. **Always MSVC env first** — `vcvars64.bat` must run before any `cargo` or `npx tauri build` command.
5. **`console=False` breaks uvicorn** — use `console=True` always. The CREATE_NO_WINDOW spawn flag in Rust hides the console anyway.
6. **Add `mcp` to hiddenimports** — FastMCP only conditionally imports `mcp`, so PyInstaller's static analysis misses it.
7. **Patch fastmcp before PyInstaller** — `fastmcp/__init__.py` calls `_version("fastmcp")` which raises `PackageNotFoundError` when dist-info is stripped. Patch with try/except, then the frozen exe carries the fix.
8. **Opentelemetry entry points broken in frozen builds** — `opentelemetry.context._load_runtime_context()` uses `importlib.metadata.entry_points()` which returns empty lists in PyInstaller onefile builds. Fix: `rthook_patch_otel.py` patches `opentelemetry.util._importlib_metadata.entry_points` to return the required entry points (context, propagator baggage+tracecontext, tracer_provider, meter_provider). The hook must NOT import `opentelemetry.context` or any submodule that triggers the context loading — only `opentelemetry.util._importlib_metadata` (a utility module with no circular deps).
9. **Smoke test must fail on any assertion** — every check (health, tools, diagnostics) must `proc.kill(); sys.exit(1)` on failure. A bare try/except that prints and falls through to "ALL CHECKS PASSED" produces false positives.
10. **Giskard backend is ~180 MB** — giskard pulls torch, scipy, sklearn, pandas, numpy, etc. Even with binary SKIP list filtering `a.binaries`, the Python code (`a.pure`) is unfilterable. Acceptable for a scanning tool; use `--onedir` mode for development iteration.
