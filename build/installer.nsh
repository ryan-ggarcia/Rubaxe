; Picked up by electron-builder (build/installer.nsh): after installing, offers to prepare Ruby for Rubaxe.
; Silent installs (/S) answer "no", so nothing is downloaded without the user's consent.
!macro customInstall
  ; `rubaxe .` in a terminal: bin\rubaxe.cmd on the user's PATH. start returns the prompt at once; ELECTRON_RUN_AS_NODE
  ; (set by some tools' terminals) would make Rubaxe.exe run as plain Node.
  CreateDirectory "$INSTDIR\bin"
  ClearErrors
  FileOpen $0 "$INSTDIR\bin\rubaxe.cmd" w
  FileWrite $0 `@echo off$\r$\nsetlocal$\r$\nset ELECTRON_RUN_AS_NODE=$\r$\nstart "" "%~dp0..\${APP_EXECUTABLE_FILENAME}" %*$\r$\n`
  FileClose $0
  ${If} ${Errors}
    MessageBox MB_ICONEXCLAMATION "Não foi possível criar $INSTDIR\bin\rubaxe.cmd: o comando rubaxe não ficará disponível no terminal." /SD IDOK
  ${Else}
    ; PowerShell edits HKCU\Environment\Path: no NSIS string limit to truncate a long PATH, %VAR% entries stay unexpanded
    ; and the value keeps its kind (REG_EXPAND_SZ). Stop: any read error aborts before a write. Path passed by env var: no quoting.
    System::Call 'Kernel32::SetEnvironmentVariable(t "RUBAXE_BIN", t "$INSTDIR\bin")i'
    nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = 'Stop'; $$d = $$env:RUBAXE_BIN; $$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p = [string]$$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$kind = if ($$k.GetValueNames() -contains 'Path') { $$k.GetValueKind('Path') } else { 'ExpandString' }; if (($$p -split ';') -notcontains $$d) { $$k.SetValue('Path', $$(if ($$p) { $$p.TrimEnd(';') + ';' + $$d } else { $$d }), $$kind) }"`
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION "Não foi possível pôr $INSTDIR\bin no PATH do usuário (código $0): o comando rubaxe não ficará disponível no terminal." /SD IDOK
    ${EndIf}
    SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000 ; WM_SETTINGCHANGE to all windows: new terminals see the PATH
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION "Configurar o Ruby agora?$\r$\n$\r$\nInstala o Ruby+Devkit (se ainda não houver), o toolchain C (ridk) e a gem ruby-lsp. Precisa de internet e pode levar vários minutos.$\r$\n$\r$\nTambém dá para fazer depois no Rubaxe: paleta (Ctrl+Shift+P) → Ruby: Configurar Ambiente." /SD IDNO IDNO rubaxeSkipRuby
    ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\src\ruby\setup-ruby.ps1"' $0
    ${If} $0 == 0
      MessageBox MB_ICONINFORMATION "Ruby, ruby-lsp e toolchain configurados."
    ${Else}
      MessageBox MB_ICONEXCLAMATION "A configuração do Ruby não terminou (código $0).$\r$\nTente de novo no Rubaxe: paleta → Ruby: Configurar Ambiente."
    ${EndIf}
  rubaxeSkipRuby:
!macroend

; Updates run the old uninstaller first and reinstall bin\ right after: keep the PATH entry then. RMDir /r $INSTDIR removes the file.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    System::Call 'Kernel32::SetEnvironmentVariable(t "RUBAXE_BIN", t "$INSTDIR\bin")i'
    nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = 'Stop'; $$d = $$env:RUBAXE_BIN; $$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$p = [string]$$k.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); $$n = ($$p -split ';' | Where-Object { $$_ -ne $$d }) -join ';'; if ($$n -ne $$p) { $$k.SetValue('Path', $$n, $$k.GetValueKind('Path')) }"`
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONEXCLAMATION "Não foi possível tirar $INSTDIR\bin do PATH do usuário (código $0). Remova a entrada à mão em Variáveis de Ambiente." /SD IDOK
    ${EndIf}
    SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
    Delete "$INSTDIR\bin\rubaxe.cmd"
  ${endIf}
!macroend
