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
