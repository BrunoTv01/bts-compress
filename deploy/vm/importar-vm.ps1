# Instala a copia (.ova) da VM do BTS Compress no VirtualBox deste computador.
# Coloque o arquivo .ova na mesma pasta deste script e de dois cliques em importar-vm.bat.
# A VM e ligada na rede do computador (modo Bridge) e pega um IP sozinha (DHCP).
param(
  [string]$Ova = "",
  [string]$Nome = "BTS-Compress",
  [string]$Placa = ""
)
$ErrorActionPreference = "Stop"
$Pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Info($m) { Write-Host "  ->  $m" -ForegroundColor Cyan }
function Aviso($m){ Write-Host "  !   $m" -ForegroundColor Yellow }
function Falha($m){ Write-Host "  ERRO  $m" -ForegroundColor Red; Read-Host "Aperte Enter para fechar"; exit 1 }

Write-Host ""
Write-Host "  BTS Compress - instalar a copia da VM" -ForegroundColor White
Write-Host ""

$VBox = @(
  "$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe",
  "${env:ProgramFiles(x86)}\Oracle\VirtualBox\VBoxManage.exe",
  "$env:VBOX_MSI_INSTALL_PATH\VBoxManage.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $VBox) { $c = Get-Command VBoxManage -ErrorAction SilentlyContinue; if ($c) { $VBox = $c.Source } }
if (-not $VBox) { Falha "VirtualBox nao encontrado. Instale em https://www.virtualbox.org/wiki/Downloads e rode de novo." }
Ok ("VirtualBox " + (& $VBox --version))

# ---------- arquivo .ova ----------
if (-not $Ova) {
  $achados = @(Get-ChildItem -Path $Pasta, ([Environment]::GetFolderPath("Desktop")), (Join-Path $env:USERPROFILE "Downloads") -Filter "*.ova" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($achados.Count -eq 0) { Falha "Nao achei nenhum arquivo .ova nesta pasta, na Area de Trabalho nem em Downloads." }
  $Ova = $achados[0].FullName
}
if (-not (Test-Path $Ova)) { Falha "Arquivo nao encontrado: $Ova" }
Ok "Copia: $Ova"

# ---------- nome livre ----------
$vms = @(& $VBox list vms | ForEach-Object { if ($_ -match '^"(.+)" \{') { $Matches[1] } })
$base = $Nome; $i = 2
while ($vms -contains $Nome) { $Nome = "$base-$i"; $i++ }

Info "Importando como '$Nome' (pode levar de 5 a 15 minutos)"
& $VBox import $Ova --vsys 0 --vmname $Nome
if ($LASTEXITCODE -ne 0) { Falha "A importacao falhou." }
Ok "VM '$Nome' criada"

# ---------- placa de rede: a que este computador usa para sair para a rede ----------
$pontes = @()
$atual = $null
foreach ($l in (& $VBox list bridgedifs)) {
  if ($l -match '^Name:\s+(.+)$') { $atual = [pscustomobject]@{ Nome = $Matches[1].Trim(); Status = ""; IP = "" }; $pontes += $atual }
  elseif ($atual -and $l -match '^Status:\s+(.+)$') { $atual.Status = $Matches[1].Trim() }
  elseif ($atual -and $l -match '^IPAddress:\s+(.+)$') { $atual.IP = $Matches[1].Trim() }
}
if (-not $Placa) {
  try {
    $rota = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
    $desc = (Get-NetAdapter -InterfaceIndex $rota.ifIndex -ErrorAction Stop).InterfaceDescription
    if ($pontes.Nome -contains $desc) { $Placa = $desc }
  } catch { }
}
if (-not $Placa) {
  $p = $pontes | Where-Object { $_.Status -eq "Up" -and $_.IP -and $_.IP -ne "0.0.0.0" -and $_.Nome -notmatch "VirtualBox|Host-Only|VMware|Hyper-V|Loopback" } | Select-Object -First 1
  if ($p) { $Placa = $p.Nome }
}
if (-not $Placa) { Falha "Nao achei uma placa de rede ativa neste computador. Ligue o cabo/Wi-Fi ou rode com -Placa ""nome da placa""." }
& $VBox modifyvm $Nome --nic1 bridged --bridgeadapter1 "$Placa" --macaddress1 auto --cableconnected1 on
if ($LASTEXITCODE -ne 0) { Falha "Nao consegui configurar a rede da VM." }
Ok "Rede: modo Bridge na placa '$Placa' (a VM pega IP do mesmo roteador deste computador)"

# ---------- liga ----------
Info "Ligando a VM"
& $VBox startvm $Nome --type gui | Out-Null
if ($LASTEXITCODE -ne 0) { Falha "Nao consegui ligar a VM." }
Ok "VM ligada"

# ---------- descobre o IP ----------
$mac = ((& $VBox showvminfo $Nome --machinereadable | Select-String '^macaddress1=').ToString() -replace '^macaddress1="?([^"]*)"?$', '$1')
$macTxt = ($mac -replace '(..)(?!$)', '$1-').ToUpper()
Info "Esperando a VM pegar um IP da rede (ate 3 minutos)"
$ip = $null
$fim = (Get-Date).AddMinutes(3)
$minha = $null
try { $minha = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $rota.ifIndex -ErrorAction Stop | Select-Object -First 1 } catch { }
while (-not $ip -and (Get-Date) -lt $fim) {
  Start-Sleep -Seconds 10
  # 1) Guest Additions, se estiverem instaladas na VM
  $gp = & $VBox guestproperty get $Nome "/VirtualBox/GuestInfo/Net/0/V4/IP" 2>$null
  if ($gp -match 'Value:\s*([0-9.]+)') { $ip = $Matches[1]; break }
  # 2) procura o MAC da VM na rede local (so redes /22 ou menores)
  if ($minha -and $minha.PrefixLength -ge 22) {
    $b = ([Net.IPAddress]$minha.IPAddress).GetAddressBytes(); [Array]::Reverse($b)
    $n = [BitConverter]::ToUInt32($b, 0); $mask = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $minha.PrefixLength))
    $rede = $n -band $mask; $qtd = [math]::Pow(2, 32 - $minha.PrefixLength) - 2
    $tarefas = for ($k = 1; $k -le $qtd; $k++) {
      $x = [BitConverter]::GetBytes([uint32]($rede + $k)); [Array]::Reverse($x)
      (New-Object Net.NetworkInformation.Ping).SendPingAsync((New-Object Net.IPAddress (,$x)), 300)
    }
    try { [Threading.Tasks.Task]::WaitAll($tarefas) } catch { }
    $viz = Get-NetNeighbor -AddressFamily IPv4 -LinkLayerAddress $macTxt -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($viz) { $ip = $viz.IPAddress }
  }
}

Write-Host ""
if ($ip) {
  $url = "http://${ip}:3000"
  Ok "A VM pegou o IP $ip"
  Info "Esperando o BTS Compress responder"
  $resp = $false
  for ($t = 0; $t -lt 30 -and -not $resp; $t++) {
    try { Invoke-WebRequest -UseBasicParsing "$url/api/health" -TimeoutSec 3 | Out-Null; $resp = $true } catch { Start-Sleep -Seconds 4 }
  }
  Write-Host ""
  Write-Host "  Endereco do sistema:  $url" -ForegroundColor White
  Write-Host "  Login: o mesmo da VM original"
  if ($resp) { Start-Process $url } else { Aviso "O sistema ainda nao respondeu; espere 1 minuto e abra o endereco no navegador." }
} else {
  Aviso "Nao consegui descobrir o IP daqui."
  Write-Host "  Na janela da VM, entre no Ubuntu: aparece um aviso com o endereco."
  Write-Host "  Ou abra o Terminal da VM e rode:  bts-endereco"
  Write-Host "  (MAC da placa da VM: $macTxt  - o responsavel pela rede acha o IP por ele no roteador)"
}
Write-Host ""
Read-Host "Aperte Enter para fechar"
