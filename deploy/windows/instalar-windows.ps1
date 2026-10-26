# Instala o BTS Compress no Windows 10/11, com PostgreSQL local.
# Use o "Instalar-BTS-Compress.bat" (dois cliques). Rodar de novo atualiza o sistema sem perder dados.
#
# O que faz:
#   1. Instala Node.js LTS e PostgreSQL 16 pelo winget (se ainda não tiver)
#   2. Baixa o BTS Compress do GitHub para C:\BTS-Compress\app
#   3. Cria o banco "bts" e o usuário "bts" com senha aleatória
#   4. Cria uma tarefa que liga o sistema junto com o Windows e libera a porta no firewall
#   5. Cria o atalho "BTS Compress" na Área de Trabalho
param(
  [int]$Porta = 3000,
  [string]$Pasta = "C:\BTS-Compress",
  [string]$Branch = "main",
  [switch]$Desinstalar
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo     = "BrunoTv01/bts-compress"
$App      = Join-Path $Pasta "app"
$Logs     = Join-Path $Pasta "logs"
$Backups  = Join-Path $Pasta "backups"
$Tarefa   = "BTS Compress"
$PgPassFile = Join-Path $Pasta "postgres-superusuario.txt"

function Ok($m)    { Write-Host "  OK  $m" -ForegroundColor Green }
function Info($m)  { Write-Host "  ->  $m" -ForegroundColor Cyan }
function Falha($m) { Write-Host ""; Write-Host "  ERRO  $m" -ForegroundColor Red; Write-Host ""; Read-Host "Aperte Enter para fechar"; exit 1 }
function Novo-Segredo([int]$n = 24) {
  $c = [char[]]"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  $b = New-Object byte[] $n; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $c[$_ % $c.Length] })
}
function Atualizar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# ---------- administrador ----------
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Pedindo permissao de administrador..."
  $argsList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Porta", $Porta, "-Pasta", "`"$Pasta`"", "-Branch", $Branch)
  if ($Desinstalar) { $argsList += "-Desinstalar" }
  Start-Process powershell -Verb RunAs -ArgumentList $argsList
  exit
}

Write-Host ""
Write-Host "  BTS Compress - instalacao no Windows" -ForegroundColor White
Write-Host ""

# ---------- desinstalar ----------
if ($Desinstalar) {
  Info "Parando e removendo a tarefa"
  Stop-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $Tarefa -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$App*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Remove-NetFirewallRule -DisplayName "BTS Compress" -ErrorAction SilentlyContinue
  Remove-Item "$([Environment]::GetFolderPath('CommonDesktopDirectory'))\BTS Compress.url" -ErrorAction SilentlyContinue
  Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
  Ok "Sistema removido. O banco de dados e os backups em $Pasta foram mantidos."
  Write-Host "     Para apagar tambem o banco: desinstale o PostgreSQL em Configuracoes > Aplicativos."
  Read-Host "Aperte Enter para fechar"; exit 0
}

# ---------- winget ----------
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Falha "O 'winget' nao foi encontrado. Atualize o 'Instalador de Aplicativo' pela Microsoft Store e rode de novo."
}
New-Item -ItemType Directory -Force -Path $Pasta, $Logs, $Backups | Out-Null

# ---------- Node.js ----------
Atualizar-Path
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeOk = $false
if ($node) {
  $nodeMaior = & node -p "process.versions.node.split('.')[0]" 2>$null
  $nodeOk = ([int]$nodeMaior) -ge 20
}
if (-not $nodeOk) {
  Info "Instalando Node.js LTS"
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Atualizar-Path
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $env:Path += ";$env:ProgramFiles\nodejs" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Falha "Nao consegui instalar o Node.js. Instale manualmente em https://nodejs.org e rode de novo." }
$NodeExe = (Get-Command node).Source
Ok "Node.js $(& node -v)"

# ---------- PostgreSQL ----------
function Achar-Psql {
  Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object { [int]$_.Directory.Parent.Name } | Select-Object -Last 1
}
$psql = Achar-Psql
if (-not $psql) {
  Info "Instalando PostgreSQL 16 (alguns minutos)"
  $pgPass = Novo-Segredo 20
  Set-Content -Path $PgPassFile -Value $pgPass -Encoding ASCII
  winget install -e --id PostgreSQL.PostgreSQL.16 --silent --accept-package-agreements --accept-source-agreements `
    --override "--mode unattended --unattendedmodeui none --superpassword $pgPass --serverport 5432 --disable-components stackbuilder" | Out-Null
  $psql = Achar-Psql
  if (-not $psql) { Falha "Nao consegui instalar o PostgreSQL. Instale manualmente em https://www.postgresql.org/download/windows/ e rode de novo." }
  # protege o arquivo com a senha do superusuário: só administradores leem
  icacls $PgPassFile /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" | Out-Null
}
$PgBin = $psql.Directory.FullName
Ok "PostgreSQL em $PgBin"
$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svc -and $svc.Status -ne "Running") { Start-Service $svc.Name }

# ---------- baixa o sistema ----------
$tmp = Join-Path $env:TEMP ("bts-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
Info "Baixando o BTS Compress ($Branch)"
try { Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile "$tmp\bts.zip" }
catch { Falha "Nao consegui baixar do GitHub. Verifique a internet." }
Expand-Archive "$tmp\bts.zip" -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like "bts-compress-*" } | Select-Object -First 1
if (-not $src) { Falha "O arquivo baixado nao tem o sistema." }
$versao = (Get-Content "$($src.FullName)\package.json" -Raw | ConvertFrom-Json).version
Ok "Versao $versao baixada"

$envFile = Join-Path $App ".env"
$jaInstalado = Test-Path $envFile
$envAntigo = if ($jaInstalado) { Get-Content $envFile -Raw } else { $null }

# ---------- atualização: para o sistema e faz backup ----------
if ($jaInstalado) {
  Info "Sistema ja instalado: atualizando"
  Stop-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$App*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  $url = ($envAntigo -split "`n" | Where-Object { $_ -like "DATABASE_URL=*" }) -replace "^DATABASE_URL=", "" -replace "`r", ""
  if ($url) {
    $arq = Join-Path $Backups ("bts-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sql")
    & "$PgBin\pg_dump.exe" --clean --if-exists --no-owner --file "$arq" "$url"
    if ($LASTEXITCODE -eq 0) { Ok "Backup do banco em $arq" }
  }
}

# ---------- copia os arquivos ----------
if (Test-Path $App) {
  Get-ChildItem $App -Force | Where-Object { $_.Name -notin @(".env", "node_modules") } | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $App | Out-Null
Copy-Item "$($src.FullName)\*" $App -Recurse -Force
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Info "Instalando as bibliotecas do sistema (npm)"
Push-Location $App
& "$(Split-Path $NodeExe)\npm.cmd" install --omit=dev --no-audit --no-fund --loglevel=error
$npmCode = $LASTEXITCODE
Pop-Location
if ($npmCode -ne 0) { Falha "O npm install falhou. Verifique a internet e rode de novo." }

# ---------- banco do sistema ----------
if (-not $jaInstalado) {
  if (-not (Test-Path $PgPassFile)) {
    Falha "O PostgreSQL ja existia neste computador e eu nao sei a senha do usuario 'postgres'. Crie o arquivo $PgPassFile contendo essa senha e rode de novo."
  }
  $env:PGPASSWORD = (Get-Content $PgPassFile -Raw).Trim()
  $dbPass = Novo-Segredo 24
  $existe = & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='bts'"
  if ($LASTEXITCODE -ne 0) { Falha "Nao consegui entrar no PostgreSQL como 'postgres'. Confira a senha em $PgPassFile." }
  if ($existe -match "1") { & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -qc "ALTER ROLE bts LOGIN PASSWORD '$dbPass'" }
  else { & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -qc "CREATE ROLE bts LOGIN PASSWORD '$dbPass'" }
  $temBanco = & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname='bts'"
  if (-not ($temBanco -match "1")) { & "$PgBin\createdb.exe" -U postgres -h 127.0.0.1 -O bts bts }
  Remove-Item Env:\PGPASSWORD
  $conteudo = "# Configuracao do BTS Compress no Windows`r`nPORT=$Porta`r`nHOST=0.0.0.0`r`nDATABASE_URL=postgres://bts:$dbPass@127.0.0.1:5432/bts`r`nNODE_ENV=production`r`n"
  [IO.File]::WriteAllText($envFile, $conteudo, (New-Object Text.UTF8Encoding $false))
  icacls $envFile /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" | Out-Null
  Ok "Banco 'bts' criado"
} else {
  Ok "Configuracao e banco mantidos"
}

# ---------- tarefa que liga o sistema com o Windows ----------
$cmd = "cd /d `"$App`" && `"$NodeExe`" server.js >> `"$Logs\bts-compress.log`" 2>&1"
$acao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmd" -WorkingDirectory $App
$gatilho = New-ScheduledTaskTrigger -AtStartup
$cfg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$quem = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $Tarefa -Action $acao -Trigger $gatilho -Settings $cfg -Principal $quem -Force | Out-Null
Start-ScheduledTask -TaskName $Tarefa
Ok "Sistema configurado para ligar junto com o Windows"

# ---------- firewall e atalho ----------
if (-not (Get-NetFirewallRule -DisplayName "BTS Compress" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "BTS Compress" -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Domain,Private | Out-Null
}
$atalho = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "BTS Compress.url"
Set-Content -Path $atalho -Value "[InternetShortcut]`r`nURL=http://localhost:$Porta/`r`n" -Encoding ASCII
Ok "Atalho 'BTS Compress' na Area de Trabalho"

# ---------- espera o sistema responder ----------
Info "Ligando o sistema"
$pronto = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Porta/api/health" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $pronto = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $pronto) { Falha "O sistema nao respondeu. Veja o log em $Logs\bts-compress.log" }

$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp, Manual -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "169.*" -and $_.IPAddress -ne "127.0.0.1" } | Select-Object -First 1).IPAddress
Write-Host ""
Ok "BTS Compress $versao instalado"
Write-Host "     Neste computador:   http://localhost:$Porta" -ForegroundColor Green
if ($ip) { Write-Host "     Na rede:            http://$($ip):$Porta" }
if (-not $jaInstalado) { Write-Host "     Login: admin   Senha: admin   (o sistema pede uma senha nova no 1o acesso)" }
Write-Host "     Log:                $Logs\bts-compress.log"
Write-Host "     Atualizar:          rode o Instalar-BTS-Compress.bat de novo"
Write-Host ""
Start-Process "http://localhost:$Porta"
Read-Host "Aperte Enter para fechar"
