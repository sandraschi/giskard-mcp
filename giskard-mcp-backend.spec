# -*- mode: python ; coding: utf-8 -*-
a = Analysis(
    ['run_server.py'],
    pathex=['src'],
    datas=[('src/giskard_mcp', 'giskard_mcp')],
    hiddenimports=[
        'mcp', 'fastmcp', 'starlette', 'uvicorn', 'giskard',
        'pydantic', 'pydantic.networks', 'pydantic.color',
        'cachetools', 'h11', 'beartype', 'websockets', 'sqlite3', 'pytz', 'jsonschema',
        'giskard.scanner', 'giskard.scan',
        '_strptime', '_datetime',
        'joserfc', 'joserfc.jwk', 'joserfc.jwt',
        'opentelemetry.context', 'opentelemetry.context.contextvars_context',
        'opentelemetry.sdk.trace', 'opentelemetry.sdk.trace.export',
    ],
    excludes=['tkinter', 'test', 'tests', 'unittest',
              'notebook', 'jupyter', 'IPython', 'matplotlib',
              'torch', 'scipy', 'sklearn', 'numba', 'llvmlite',
              'tensorflow', 'keras'],
    noarchive=True,
    runtime_hooks=['rthook_patch_otel.py'],
)
# Strip .dist-info but preserve metadata for packages that need it
_keep_dist = ['fastmcp-', 'mcp-', 'pydantic-', 'fastapi-', 'starlette-', 'giskard-', 'email_validator-']
_saved = [e for e in a.datas if isinstance(e, tuple) and any(k in str(e[0]) for k in _keep_dist) and '.dist-info' in str(e[0])]
for _list in [a.datas, a.binaries, a.zipfiles, a.scripts]:
    _list[:] = [e for e in _list if not (isinstance(e, tuple) and '.dist-info' in str(e[0]))]
a.datas.extend(_saved)
SKIP = ['torch', 'playwright', 'bitsandbytes', 'llvmlite', 'pyarrow', 'pymupdf',
        'grpc', 'numba', 'Cython', 'google', 'azure', 'boto3', 'botocore',
        'matplotlib', 'scipy', 'sklearn', 'onnxruntime',
        'tensorflow', 'keras']
a.binaries = [b for b in a.binaries if not any(s in b[0].lower() for s in SKIP)]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.zipfiles, a.datas, name='giskard-mcp-backend', debug=False, strip=False, upx=False, upx_exclude=[], runtime_tmpdir=None, console=True)
