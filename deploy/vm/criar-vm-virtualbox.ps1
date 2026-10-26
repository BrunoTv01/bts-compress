# Cria uma máquina virtual no VirtualBox e instala sozinha o Ubuntu Server 24.04 + BTS Compress.
# Use o arquivo criar-vm.bat (dois cliques) ou, no PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\criar-vm-virtualbox.ps1
#
# Depois de pronto, no navegador do Windows:  http://localhost:3000   (admin / admin)
param(
  [string]$Nome = "BTS-Compress",
  [int]$MemoriaMB = 2048,
  [int]$CPUs = 2,
  [int]$DiscoGB = 25,
  [int]$PortaWeb = 3000,
  [int]$PortaSSH = 2222,
  [string]$IsoUbuntu = ""
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$Seed  = Join-Path $Pasta "bts-compress-seed.iso"
$Rel   = "https://releases.ubuntu.com/24.04"

function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Info($m) { Write-Host "  ->  $m" -ForegroundColor Cyan }
function Falha($m){ Write-Host "  ERRO  $m" -ForegroundColor Red; Read-Host "Aperte Enter para fechar"; exit 1 }

Write-Host ""
Write-Host "  BTS Compress - criar maquina virtual no VirtualBox" -ForegroundColor White
Write-Host ""

# ---------- VirtualBox ----------
$VBox = @(
  "$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe",
  "${env:ProgramFiles(x86)}\Oracle\VirtualBox\VBoxManage.exe",
  "$env:VBOX_MSI_INSTALL_PATH\VBoxManage.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $VBox) {
  $cmd = Get-Command VBoxManage -ErrorAction SilentlyContinue
  if ($cmd) { $VBox = $cmd.Source }
}
if (-not $VBox) { Falha "VirtualBox nao encontrado. Instale em https://www.virtualbox.org/wiki/Downloads e rode de novo." }
$ver = & $VBox --version
Ok "VirtualBox $ver"
function VB { & $VBox @args; if ($LASTEXITCODE -ne 0) { Falha "VBoxManage $($args -join ' ') falhou." } }

if (-not (Test-Path $Seed)) { Falha "Arquivo bts-compress-seed.iso nao esta na mesma pasta deste script." }

$existe = (& $VBox list vms) -match "`"$Nome`""
if ($existe) { Falha "Ja existe uma VM chamada '$Nome'. Apague-a no VirtualBox ou rode com -Nome OutroNome." }

# ---------- ISO do Ubuntu ----------
if (-not $IsoUbuntu) {
  Info "Procurando a versao mais nova do Ubuntu Server 24.04"
  $sums = (Invoke-WebRequest -UseBasicParsing "$Rel/SHA256SUMS").Content
  # linhas "HASH *ubuntu-24.04.x-live-server-amd64.iso"; pega a versão mais nova pelo nome
  $itens = $sums -split "`n" | Where-Object { $_ -match "^([0-9a-f]{64}) \*?(ubuntu-24\.04[0-9.]*-live-server-amd64\.iso)" } |
    ForEach-Object { [pscustomobject]@{ Hash = $Matches[1]; Arq = $Matches[2]; Ver = [version]((($Matches[2] -replace '^ubuntu-([0-9.]+)-live.*$', '$1')) + '.0') } }
  $escolha = $itens | Sort-Object Ver | Select-Object -Last 1
  if (-not $escolha) { Falha "Nao achei a ISO do Ubuntu Server em $Rel" }
  $hash = $escolha.Hash; $arq = $escolha.Arq
  $IsoUbuntu = Join-Path $Pasta $arq
  if (-not (Test-Path $IsoUbuntu)) {
    Info "Baixando $arq (cerca de 3 GB, pode demorar)"
    & curl.exe -L --fail --progress-bar -o "$IsoUbuntu.part" "$Rel/$arq"
    if ($LASTEXITCODE -ne 0) { Falha "Download do Ubuntu falhou. Verifique a internet e rode de novo." }
    Move-Item -Force "$IsoUbuntu.part" $IsoUbuntu
  }
  Info "Conferindo o arquivo baixado"
  $calc = (Get-FileHash -Algorithm SHA256 $IsoUbuntu).Hash.ToLower()
  if ($calc -ne $hash.ToLower()) { Remove-Item $IsoUbuntu; Falha "A ISO baixada veio corrompida e foi apagada. Rode de novo." }
}
if (-not (Test-Path $IsoUbuntu)) { Falha "ISO do Ubuntu nao encontrada: $IsoUbuntu" }
Ok "Ubuntu: $(Split-Path -Leaf $IsoUbuntu)"

# ---------- cria a VM ----------
Info "Criando a maquina virtual '$Nome'"
VB createvm --name $Nome --ostype Ubuntu_64 --register | Out-Null
$info = & $VBox showvminfo $Nome --machinereadable
$cfg  = ($info | Where-Object { $_ -like 'CfgFile=*' }) -replace '^CfgFile="(.*)"$', '$1'
$Disco = Join-Path (Split-Path -Parent $cfg) "$Nome.vdi"

# disco primeiro: vazio ele pula para o CD; depois de instalado, liga pelo disco
VB modifyvm $Nome --memory $MemoriaMB --cpus $CPUs --vram 16 --graphicscontroller vmsvga `
  --boot1 disk --boot2 dvd --boot3 none --boot4 none `
  --nic1 nat --natpf1 "web,tcp,127.0.0.1,$PortaWeb,,3000" --natpf1 "ssh,tcp,127.0.0.1,$PortaSSH,,22"
VB createmedium disk --filename $Disco --size ($DiscoGB * 1024) --format VDI | Out-Null
VB storagectl $Nome --name SATA --add sata --controller IntelAhci --portcount 3
VB storageattach $Nome --storagectl SATA --port 0 --device 0 --type hdd --medium $Disco
VB storageattach $Nome --storagectl SATA --port 1 --device 0 --type dvddrive --medium $IsoUbuntu
VB storageattach $Nome --storagectl SATA --port 2 --device 0 --type dvddrive --medium $Seed
Ok "VM criada: $MemoriaMB MB, $CPUs CPUs, disco de $DiscoGB GB"

Info "Ligando a VM"
VB startvm $Nome --type gui | Out-Null

Write-Host ""
Write-Host "  A janela da VM abriu. Agora:" -ForegroundColor White
Write-Host "   1. Quando aparecer 'Continue with autoinstall? (yes/no)', clique na janela da VM,"
Write-Host "      digite  yes  e aperte Enter."
Write-Host "   2. Espere: o Ubuntu instala sozinho (10 a 20 min) e reinicia."
Write-Host "   3. No primeiro boot o BTS Compress e instalado (mais uns 5 min)."
Write-Host ""
Write-Host "  Quando terminar, abra no navegador:  http://localhost:$PortaWeb" -ForegroundColor Green
Write-Host "     Sistema:  admin / admin   (pede senha nova no 1o acesso)"
Write-Host "     Linux da VM:  suporte / admin    SSH:  ssh -p $PortaSSH suporte@localhost"
Write-Host ""
Read-Host "Aperte Enter para fechar esta janela (a VM continua ligada)"
