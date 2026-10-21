; Picked up by electron-builder (build/installer.nsh): after installing, offers to prepare Ruby for Rubaxe.
; Silent installs (/S) answer "no", so nothing is downloaded without the user's consent.
!macro customInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Configurar o Ruby agora?$\r$\n$\r$\nInstala o Ruby+Devkit (se ainda não houver), o toolchain C (ridk) e a gem ruby-lsp. Precisa de internet e pode levar vários minutos.$\r$\n$\r$\nTambém dá para fazer depois no Rubaxe: paleta (Ctrl+Shift+P) → Ruby: Configurar Ambiente." /SD IDNO IDNO rubaxeSkipRuby
    ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\src\ruby\setup-ruby.ps1"' $0
    ${If} $0 == 0
      MessageBox MB_ICONINFORMATION "Ruby, ruby-lsp e toolchain configurados."
    ${Else}
      MessageBox MB_ICONEXCLAMATION "A configuração do Ruby não terminou (código $0).$\r$\nTente de novo no Rubaxe: paleta → Ruby: Configurar Ambiente."
    ${EndIf}
  rubaxeSkipRuby:
!macroend
