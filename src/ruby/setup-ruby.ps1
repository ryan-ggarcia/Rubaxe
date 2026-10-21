# Prepara o Ruby para o Rubaxe no Windows: instala o Ruby+Devkit se faltar, o toolchain C (ridk) e a gem ruby-lsp.
# Pode rodar de novo a qualquer momento: pula o que ja existe. Usado pelo instalador e por "Ruby: Configurar Ambiente".
param([string]$Ruby) # ruby.exe a configurar; vazio = o do PATH (ou instala um)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # a barra de progresso do Invoke-WebRequest deixa o download muito lento no PS 5.1
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what falhou (codigo $LASTEXITCODE)" } }

try {
  if (-not $Ruby) { $Ruby = (Get-Command ruby.exe -ErrorAction SilentlyContinue).Source }
  if (-not $Ruby) {
    Step 'Ruby nao encontrado: baixando o RubyInstaller (Ruby+Devkit)'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod 'https://api.github.com/repos/oneclick/rubyinstaller2/releases/latest' -Headers @{ 'User-Agent' = 'Rubaxe' }
    $asset = $release.assets | Where-Object { $_.name -match '^rubyinstaller-devkit-[\d.]+-\d+-x64\.exe$' } | Select-Object -First 1
    if (-not $asset) { throw 'instalador Ruby+Devkit x64 nao encontrado na ultima versao do RubyInstaller' }
    $installer = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $installer -UseBasicParsing
    Step "Instalando $($asset.name) (pode levar alguns minutos)"
    # ridk roda logo abaixo, fora do instalador, para o progresso aparecer nesta janela.
    # Atencao: o RubyInstaller substitui (desinstala) um Ruby da mesma serie X.Y ja instalado fora do PATH.
    $p = Start-Process $installer -ArgumentList '/verysilent', '/currentuser', '/tasks=modpath,assocfiles,noridkinstall' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "o instalador do Ruby falhou (codigo $($p.ExitCode))" }
    # O instalador pos o Ruby no PATH de processos novos; este processo precisa reler o PATH.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $Ruby = (Get-Command ruby.exe -ErrorAction SilentlyContinue).Source
    if (-not $Ruby) { throw 'o Ruby foi instalado mas nao apareceu no PATH' }
  }
  $root = Split-Path (Split-Path $Ruby)
  Write-Host "Ruby: $(& $Ruby -v)"

  if (Test-Path "$root\msys64\ucrt64\bin\gcc.exe") {
    Step 'Toolchain C (ridk) ja instalado'
  } else {
    Step 'Instalando o toolchain C com ridk install 1 2 3 (MSYS2 + MINGW; pode levar varios minutos)'
    & "$root\bin\ridk.cmd" install 1 2 3
    Check 'ridk install'
  }

  if ((& "$root\bin\gem.cmd" list -i '^ruby-lsp$') -eq 'true') {
    Step 'Gem ruby-lsp ja instalada'
  } else {
    Step 'Instalando a gem ruby-lsp'
    & "$root\bin\gem.cmd" install ruby-lsp --no-document
    Check 'gem install ruby-lsp'
  }

  Step 'Pronto: Ruby, ruby-lsp e toolchain configurados. No Rubaxe, use "Ruby: Reiniciar Ruby LSP" se ele ja estiver aberto.'
  exit 0
} catch {
  Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
