; -- native/windows/hooks.nsh --
; Kill UI + backend before install/uninstall (backend locks resources/*.exe).
!macro KillFleetProcesses
  DetailPrint "Stopping Giskard MCP processes..."
  ExecWait 'taskkill /F /IM giskard-mcp-backend.exe /T' $0
  ExecWait 'taskkill /F /IM giskard-mcp-native.exe /T' $0
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "giskard-mcp-backend.exe"
    Pop $0
    nsis_tauri_utils::KillProcessCurrentUser "giskard-mcp-native.exe"
    Pop $0
  !else
    nsis_tauri_utils::KillProcess "giskard-mcp-backend.exe"
    Pop $0
    nsis_tauri_utils::KillProcess "giskard-mcp-native.exe"
    Pop $0
  !endif
  Sleep 2000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillFleetProcesses
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillFleetProcesses
!macroend
