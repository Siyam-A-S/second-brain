!macro customInstall
  DetailPrint "Checking Second Brain runtime dependencies..."
  IfFileExists "$INSTDIR\resources\installer\install-second-brain-runtime.ps1" 0 runtime_done
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\install-second-brain-runtime.ps1"'
  runtime_done:
!macroend
