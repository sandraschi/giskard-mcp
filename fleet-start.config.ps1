# Per-repo fleet start config for giskard-mcp
# Edit ports/backend target here - start.ps1 is fleet-standard.
@{
    Name         = 'giskard-mcp'
    BackendPort  = 11056
    FrontendPort = 11057
    HealthPath   = '/health'
    WebRoot      = 'webapp\frontend'
    Backend = @{
        Kind          = 'uvicorn'
        UvicornTarget = 'giskard_mcp.app:app'
        SyncExtras    = @('dev')
        Env           = @{ WEB_PORT = '11056' }
    }
    Frontend = @{
        Kind           = 'vite-npm'
        PackageManager = 'npm'
        PortEnvVar     = 'VITE_PORT'
        ApiTargetEnv   = 'VITE_API_TARGET'
    }
}
