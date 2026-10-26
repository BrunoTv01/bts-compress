# ISO para máquina virtual

Duas formas de instalar o BTS Compress numa máquina virtual (VirtualBox, VMware, Hyper-V, Proxmox) sem digitar comandos.

Nas duas, a VM precisa de **2 CPUs, 2 GB de RAM, disco de 20 GB e rede com internet**. **O disco da VM é apagado** na instalação.

Ao terminar, a tela da VM mostra o endereço do sistema:

| Acesso | Login | Senha |
|---|---|---|
| BTS Compress (navegador) | `admin` | `admin` (troca obrigatória no 1º acesso) |
| Linux da VM (console/SSH) | `suporte` | `admin` (troque com `passwd`) |

## Forma 1: duas ISOs (pronta para usar)

1. Baixe a ISO oficial do **Ubuntu Server 24.04** em https://ubuntu.com/download/server.
2. Crie a VM e coloque **duas** unidades de CD:
   - CD 1: a ISO do Ubuntu (boot por ela);
   - CD 2: `bts-compress-autoinstall.iso` (rótulo `CIDATA`).
3. Ligue a VM. Quando aparecer **"Continue with autoinstall? (yes/no)"**, digite `yes` e Enter.
4. O Ubuntu se instala sozinho (10 a 20 min) e reinicia. Tire os CDs se a VM pedir.
5. No primeiro boot o BTS Compress é instalado (uns 5 min). O log fica em `/var/log/bts-compress-instalacao.log`.

Para gerar a `bts-compress-autoinstall.iso` de novo (por exemplo, depois de atualizar o sistema):

```bash
tar czf /tmp/bts-compress.tar.gz --exclude=.git --exclude=node_modules -C .. bts-compress
python3 deploy/iso/gerar-seed-iso.py bts-compress-autoinstall.iso deploy/iso/user-data deploy/iso/meta-data /tmp/bts-compress.tar.gz
```

## Forma 2: uma ISO só

Num computador com Linux (ou WSL no Windows) e internet, dentro da pasta do projeto:

```bash
./deploy/iso/criar-iso.sh
```

O script baixa o Ubuntu Server 24.04, confere o arquivo e gera `bts-compress-ubuntu.iso`. Essa ISO instala tudo sem nenhuma pergunta: basta dar boot por ela.

Se já tiver a ISO do Ubuntu baixada: `./deploy/iso/criar-iso.sh ubuntu-24.04.x-live-server-amd64.iso`.

## O que é configurado

- Ubuntu Server 24.04, idioma pt_BR, teclado ABNT2, fuso de São Paulo, disco em LVM, SSH ligado.
- Nome da máquina: `bts-compress`.
- PostgreSQL local, Node.js 22 e o BTS Compress como serviço, iniciando junto com a VM.
- Os arquivos de configuração são `user-data` e `meta-data` nesta pasta. Para mudar usuário, senha do Linux ou disco, edite o `user-data` e gere a ISO de novo.
