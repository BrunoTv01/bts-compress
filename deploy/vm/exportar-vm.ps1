# Cria a cópia (.ova) da VM do BTS Compress, pronta para ligar em outro computador ou servidor.
# Antes, DENTRO da VM:  sudo bash deploy/vm/preparar-copia.sh   (deixa a rede automática e desliga)
# Depois, aqui no Windows: dois cliques em exportar-vm.bat
param(
  [string]$Nome = "",
  [string]$Saida = ""
)
$ErrorActionPreference = "Stop"
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Info($m) { Write-Host "  ->  $m" -ForegroundColor Cyan }
function Falha($m){ Write-Host "  ERRO  $m" -ForegroundColor Red; Read-Host "Aperte Enter para fechar"; exit 1 }

Write-Host ""
Write-Host "  BTS Compress - criar copia da VM (.ova)" -ForegroundColor White
Write-Host ""

$VBox = @(
  "$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe",
  "${env:ProgramFiles(x86)}\Oracle\VirtualBox\VBoxManage.exe",
  "$env:VBOX_MSI_INSTALL_PATH\VBoxManage.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $VBox) { $c = Get-Command VBoxManage -ErrorAction SilentlyContinue; if ($c) { $VBox = $c.Source } }
if (-not $VBox) { Falha "VirtualBox nao encontrado neste computador." }

# ---------- escolhe a VM ----------
$vms = @(& $VBox list vms | ForEach-Object { if ($_ -match '^"(.+)" \{') { $Matches[1] } })
if ($vms.Count -eq 0) { Falha "Nenhuma VM encontrada no VirtualBox." }
if (-not $Nome) {
  if ($vms.Count -eq 1) { $Nome = $vms[0] }
  else {
    Write-Host "  Maquinas virtuais encontradas:"
    for ($i = 0; $i -lt $vms.Count; $i++) { Write-Host ("    {0}) {1}" -f ($i + 1), $vms[$i]) }
    $n = Read-Host "  Numero da VM do BTS Compress"
    if (-not ($n -as [int]) -or [int]$n -lt 1 -or [int]$n -gt $vms.Count) { Falha "Numero invalido." }
    $Nome = $vms[[int]$n - 1]
  }
}
if ($vms -notcontains $Nome) { Falha "VM '$Nome' nao existe no VirtualBox." }
Ok "VM: $Nome"

# ---------- precisa estar desligada ----------
$estado = (& $VBox showvminfo $Nome --machinereadable | Select-String '^VMState=').ToString() -replace '^VMState="?([^"]*)"?$', '$1'
if ($estado -ne "poweroff" -and $estado -ne "aborted") {
  Falha "A VM esta ligada ($estado). Dentro dela rode:  sudo bash deploy/vm/preparar-copia.sh   (ela desliga sozinha) e depois rode este arquivo de novo."
}

# ---------- arquivo de saida ----------
if (-not $Saida) {
  $desk = [Environment]::GetFolderPath("Desktop")
  $Saida = Join-Path $desk ("BTS-Compress-{0}.ova" -f (Get-Date -Format "yyyyMMdd-HHmm"))
}
if (Test-Path $Saida) { Remove-Item $Saida -Force }

Info "Criando a copia em $Saida (pode levar de 5 a 20 minutos)"
# nomacs = cada importacao recebe placas de rede com MAC novo (e por isso um IP proprio)
& $VBox export $Nome -o $Saida --ovf20 --options manifest,nomacs --vsys 0 --product "BTS Compress" --description "Sistema BTS Compress (PostgreSQL). Acesso: http://IP-DA-VM:3000"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Saida)) { Falha "A exportacao falhou." }
$tam = "{0:N1} GB" -f ((Get-Item $Saida).Length / 1GB)
Ok "Copia criada: $Saida ($tam)"
Write-Host ""
Write-Host "  Para instalar em outro computador com VirtualBox: copie o .ova e o arquivo"
Write-Host "  importar-vm.bat para a mesma pasta e de dois cliques no importar-vm.bat."
Write-Host "  VMware / Proxmox: importe o .ova pelo painel deles (veja deploy\vm\LEIA-ME.md)."
Write-Host ""
Read-Host "Aperte Enter para fechar"
