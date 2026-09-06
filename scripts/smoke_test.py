"""Smoke test for frozen backend exe."""
import os, subprocess, time, sys, urllib.request, urllib.error

exe = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist", "giskard-mcp-backend.exe")
if not os.path.exists(exe):
    print(f"Not found: {exe}")
    sys.exit(1)

env = os.environ.copy()
env["GISKARD_MCP_PORT"] = "11056"
env["GISKARD_TAURI"] = "1"

proc = subprocess.Popen([exe], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"Started PID {proc.pid}, waiting 40s...")
time.sleep(40)

if proc.poll() is not None:
    print(f"Process exited with code {proc.returncode}")
    sys.exit(1)

try:
    r = urllib.request.urlopen("http://127.0.0.1:11056/health", timeout=5)
    print(f"HEALTH: {r.status} {r.read().decode()}")
except Exception as e:
    print(f"HEALTH FAILED: {e}")
    proc.kill()
    sys.exit(1)

try:
    r2 = urllib.request.urlopen("http://127.0.0.1:11056/api/v1/tools", timeout=5)
    print(f"TOOLS: {r2.status}")
    data = r2.read().decode()
    import json
    j = json.loads(data)
    assert j.get("success") is True
    assert j.get("total", 0) >= 3
    print(f"TOOLS DATA OK ({j['total']} tools found)")
except Exception as e:
    print(f"TOOLS FAILED: {e}")
    proc.kill()
    sys.exit(1)

try:
    r3 = urllib.request.urlopen("http://127.0.0.1:11056/api/v1/diagnostics", timeout=5)
    print(f"DIAGNOSTICS: {r3.status}")
except Exception as e:
    print(f"DIAG FAILED: {e}")
    proc.kill()
    sys.exit(1)

print("*** ALL CHECKS PASSED ***")
proc.kill()
proc.wait()
