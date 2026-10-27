# Criar a máquina virtual (VirtualBox, Windows)

Cria a VM, instala o Ubuntu Server 24.04, o PostgreSQL e o BTS Compress sozinho.

## Antes

- **VirtualBox 7** instalado: https://www.virtualbox.org/wiki/Downloads
- Internet (baixa o Ubuntu, cerca de 3 GB, só na primeira vez)
- 25 GB livres no disco do Windows

## Passo a passo

1. Baixe o sistema: https://github.com/BrunoTv01/bts-compress/archive/refs/heads/main.zip e extraia.
2. Abra a pasta `deploy\vm` e dê **dois cliques em `criar-vm.bat`**.
3. O script baixa o Ubuntu, cria a VM **BTS-Compress** e liga.
4. Na janela da VM, quando aparecer **`Continue with autoinstall? (yes/no)`**, clique nela, digite `yes` e Enter.
5. Espere: o Ubuntu instala (10 a 20 min) e reinicia; no primeiro boot o BTS Compress é instalado (uns 5 min).
6. Abra no navegador do Windows: **http://localhost:3000**

| Acesso | Login | Senha |
|---|---|---|
| BTS Compress | `admin` | `admin` (pede senha nova no 1º acesso) |
| Linux da VM | `suporte` | `admin` |
| SSH | `ssh -p 2222 suporte@localhost` | `admin` |

## Opções

No PowerShell, dentro de `deploy\vm`:

```powershell
.\criar-vm.bat -MemoriaMB 4096 -CPUs 4 -DiscoGB 40
.\criar-vm.bat -IsoUbuntu C:\Downloads\ubuntu-24.04.3-live-server-amd64.iso
```

## Acesso pela rede da empresa

Por padrão o sistema só abre no próprio computador (`localhost`). Para outros computadores acessarem, no VirtualBox:
**VM → Configurações → Rede → Adaptador 1 → Conectado a: Placa em modo bridge**. Reinicie a VM; o endereço aparece na tela dela.

## Se algo der errado

- Log da instalação, dentro da VM: `sudo cat /var/log/bts-compress-instalacao.log`
- Para recomeçar: no VirtualBox, clique com o botão direito na VM → **Remover → Apagar todos os arquivos**, e rode o `criar-vm.bat` de novo.

# Fazer uma cópia da VM (.ova) que pega IP sozinha

Serve para levar a VM pronta (com o banco e os dados) para outro computador ou servidor.
Quando a cópia liga, ela procura a rede e pega um IP por DHCP, em qualquer placa de rede.

## 1. Dentro da VM: preparar

```bash
cd ~/Downloads
wget -O bts-compress-main.tar.gz https://github.com/BrunoTv01/bts-compress/archive/refs/heads/main.tar.gz
tar xzf bts-compress-main.tar.gz
sudo bash bts-compress-main/deploy/vm/preparar-copia.sh --compactar
```

O script:

- faz backup do banco;
- deixa a rede automática (DHCP) para qualquer placa, mesmo com outro nome ou MAC;
- desliga perfis de rede com IP fixo;
- apaga a identidade da máquina (machine-id, leases DHCP, chaves SSH), para cada cópia pedir um IP próprio;
- mostra o endereço do sistema na tela de login, no SSH e no comando `bts-endereco`;
- desliga a VM.

`--compactar` deixa o .ova bem menor (demora alguns minutos a mais).

## 2. No Windows: criar a cópia

Com a VM desligada, dois cliques em **`exportar-vm.bat`**. O arquivo `BTS-Compress-AAAAMMDD-HHMM.ova` vai para a Área de Trabalho.

Pelo VirtualBox, sem o script: **Arquivo → Exportar Appliance → OVF 2.0 → Política de MAC: "Gerar novos endereços MAC"**.

## 3. No outro computador: instalar a cópia

**VirtualBox:** copie o `.ova` e o `importar-vm.bat` (com o `importar-vm.ps1`) para a mesma pasta. Dê dois cliques em **`importar-vm.bat`**. Ele:

- importa a VM;
- liga a rede em modo Bridge na placa que o computador usa para a internet;
- liga a VM, descobre o IP e abre o sistema no navegador.

**VMware ESXi / Workstation:** *Deploy from OVF/OVA* e escolha o `.ova`. Ligue a placa de rede da VM na rede do servidor.

**Proxmox:** copie o `.ova` para o servidor e rode:

```bash
tar xf BTS-Compress-*.ova
qm importovf 200 *.ovf local-lvm
qm set 200 --net0 virtio,bridge=vmbr0
qm start 200
```

## 4. Descobrir o IP da cópia

- **Na janela da VM:** depois de entrar no Ubuntu, aparece um aviso com o endereço. Na tela de login em modo texto, o endereço aparece em cima.
- **No terminal da VM:** `bts-endereco`
- **No roteador:** procure pelo nome `teste-VirtualBox` ou pelo MAC que o `importar-vm.bat` mostra.

O endereço do sistema fica `http://IP-DA-VM:3000`. O login e os dados são os mesmos da VM original.

Para o IP não mudar, peça ao responsável pela rede uma **reserva de DHCP** para o MAC da VM.
