; Packaged-installer overrides. Wired through `nsis.include` in electron-builder.yml.
;
; Why this file exists
; --------------------
; electron-builder's stock CHECK_APP_RUNNING (include/allowOnlyOneInstallerInstance.nsh)
; shells out to Windows PowerShell and kills every process whose image path starts with
; $INSTDIR:
;
;   Get-CimInstance Win32_Process | ? { $_.Path -and $_.Path.StartsWith('$INSTDIR') }
;
; If $INSTDIR is empty or otherwise not yet resolved at that point, StartsWith('')
; matches every process with a path. The installer then tries to stop unrelated
; processes, fails on the ones it may not touch, and blocks on 「MacroBay 无法关闭」.
; That dialog has nothing to do with the app being installed.
;
; Replacing it with a plain taskkill by image name keeps the useful half of the
; behaviour (close a running copy of the app before overwriting files) without
; spawning PowerShell or matching on paths.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}" /F'
  Pop $0
!macroend
