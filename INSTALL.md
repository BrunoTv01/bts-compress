# Instalação em servidor Linux

Duas formas de instalar. Escolha uma.

| | Opção A: script (recomendado) | Opção B: Docker |
|---|---|---|
| Para quem | Servidor Linux dedicado ou VM | Quem já usa Docker |
| Sistemas | Ubuntu 22.04+, Debian 12+, Rocky/Alma/RHEL 9 | Qualquer Linux com Docker |
| Instala | Node.js 22, PostgreSQL, serviço systemd, nginx (opcional) | Dois contêineres: sistema e PostgreSQL |
| Configurar banco | Não: o instalador cria tudo | Não: já vem pronto |

Requisitos mínimos: 1 CPU, 1 GB de RAM, 2 GB de disco e acesso à internet durante a instalação (para baixar Node.js, PostgreSQL e as duas bibliotecas do sistema).

Versão atual: **1.4.0**: importa os dados do Render; login padrão `admin` / `admin`, encontra e configura o banco sozinho, com login de usuários, perfis, cadastro de serviços e equipamentos, inclusão e exclusão de linhas e a tela de entrada animada.

---

## Jeito mais rápido: um comando

No terminal do servidor Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash
```

Ele baixa a versão mais nova do GitHub, instala Node.js e PostgreSQL, cria o banco local, carrega os dados da planilha e liga o sistema. No final mostra o endereço. Entre com login **admin** e senha **admin**.

Para atualizar depois, rode **o mesmo comando**: ele detecta a instalação, faz backup do banco e atualiza sem perder dados.

Com opções (por exemplo, publicar na porta 80):

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash -s -- --nginx
```

Se o servidor não tiver o `curl`: `sudo apt install curl` (Ubuntu/Debian) ou `sudo dnf install curl` (Rocky/RHEL).

---

## Máquina virtual pronta (VirtualBox no Windows)

Dois cliques em `deploy\vm\criar-vm.bat`: ele baixa o Ubuntu, cria a VM e instala tudo. Veja **[deploy/vm/LEIA-ME.md](deploy/vm/LEIA-ME.md)**.

## Máquina virtual: ISO que instala tudo

Para criar uma VM do zero, sem digitar comandos, use a ISO de instalação automática. Ela instala o Ubuntu Server 24.04, o PostgreSQL e o BTS Compress. Veja **[deploy/iso/LEIA-ME.md](deploy/iso/LEIA-ME.md)**.

---

## Opção A: script de instalação (passo a passo)

### 1. Copie o projeto para o servidor

Com git:

```bash
git clone https://github.com/BrunoTv01/bts-compress.git
cd bts-compress
```

Ou baixe a versão pronta (não precisa de git):

```bash
curl -L -o bts-compress.tar.gz https://github.com/BrunoTv01/bts-compress/archive/refs/heads/main.tar.gz
tar xzf bts-compress.tar.gz
cd bts-compress-main
```

Se o servidor não tiver acesso ao GitHub, copie o arquivo `bts-compress-1.4.0.tar.gz` para ele (por `scp` ou pendrive) e extraia:

```bash
tar xzf bts-compress-1.4.0.tar.gz
cd bts-compress
```

### 2. Rode o instalador

```bash
sudo ./deploy/install.sh
```

No final aparece o endereço do sistema.

| Login | Senha |
|---|---|
| `admin` | `admin` |

### 3. Primeiro acesso

1. Abra o endereço no navegador e entre com login **admin** e senha **admin**.
2. O sistema pede uma senha nova, só sua. A senha `admin` deixa de funcionar.
3. Na aba **Usuários**, cadastre as outras pessoas com o perfil certo:
   - **Leitura**: só consulta.
   - **Editor**: inclui, exclui e altera dados.
   - **Admin**: tudo isso e também gerencia usuários.

Cada pessoa recebe uma senha provisória e cria a própria senha no primeiro acesso.

Opções do instalador:

| Opção | O que faz |
|---|---|
| `--senha S` | Usa outra senha inicial em vez de `admin`. Em uma reinstalação, redefine a senha do `admin` |
| `--porta N` | Porta do sistema (padrão 3000) |
| `--nginx` | Publica na porta 80 através do nginx. O sistema passa a aceitar conexões só pelo nginx |
| `--dominio nome` | Nome do servidor no nginx, por exemplo `bts.cultura.local` |
| `--sem-banco` | Usa um PostgreSQL de outro servidor. Defina `DATABASE_URL` antes de rodar |

Exemplos:

```bash
# na porta 80, com nginx
sudo ./deploy/install.sh --nginx

# usando um PostgreSQL de outro servidor
sudo DATABASE_URL=postgres://usuario:senha@10.0.0.5:5432/bts ./deploy/install.sh --sem-banco
```

O instalador pode ser rodado de novo sem perder dados. Os dados, os usuários e a configuração ficam preservados. Rodar com `--senha` redefine a senha do `admin`.

### O que fica onde

| Item | Local |
|---|---|
| Sistema | `/opt/bts-compress` |
| Configuração (porta, banco, senha inicial) | `/etc/bts-compress.env` |
| Serviço | `bts-compress` (systemd), inicia junto com o servidor |
| Banco | PostgreSQL local, banco `bts`, usuário `bts` |
| Backups | `/var/backups/bts-compress` |

### Comandos do dia a dia

```bash
sudo systemctl status bts-compress      # está rodando?
sudo systemctl restart bts-compress     # reiniciar
sudo journalctl -u bts-compress -f      # ver o log ao vivo
sudo nano /etc/bts-compress.env         # mudar porta (depois reinicie)
sudo /opt/bts-compress/deploy/reset-senha.sh             # admin volta para admin / admin
```

### Backup

```bash
sudo /opt/bts-compress/deploy/backup.sh             # faz um backup agora
sudo /opt/bts-compress/deploy/backup.sh --agendar   # backup automático todo dia às 02:30
sudo /opt/bts-compress/deploy/backup.sh --restaurar /var/backups/bts-compress/ARQUIVO.sql.gz
```

São mantidos os 30 backups mais recentes. Vale copiar a pasta `/var/backups/bts-compress` para outro servidor de vez em quando.

### Atualizar para uma versão nova

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash
```

Ou, se instalou com git: `cd bts-compress && git pull && sudo ./deploy/update.sh`.

O `update.sh` faz backup do banco, copia os arquivos novos e reinicia. Mudanças na estrutura do banco são aplicadas sozinhas, sem perder dados.

**Vindo de uma versão sem login (1.0):** depois do `update.sh`, a tela de login aparece. Entre com o usuário `admin` e a mesma senha que você usava para editar (a do `--senha` da instalação); se não tinha passado `--senha`, use `admin`. O sistema pede uma senha nova e, a partir daí, você cadastra as outras pessoas na aba **Usuários**. Para ver a senha antiga: `sudo grep ADMIN_TOKEN /etc/bts-compress.env`.

### Trazer os dados do Render (ou de outro PostgreSQL)

Se vocês já usaram o sistema no Render e querem continuar no servidor local com os mesmos dados, usuários e senhas:

1. No Render, abra **bts-compress-db → Connect** e copie o **External Database URL**.
2. No servidor, com o sistema já instalado, rode (com o endereço entre aspas):

   ```bash
   sudo /opt/bts-compress/deploy/importar-banco.sh "postgresql://...render.com/bts"
   ```

O script faz backup do banco local, baixa tudo do Render, grava no banco local e reinicia o sistema. Se der erro no meio, ele volta o banco local como estava. A cópia baixada fica em `/var/backups/bts-compress`.

Depois da importação, o banco local passa a ser o principal. Alterações feitas no Render a partir daí não vêm junto; para trazer de novo, rode o script outra vez (ele substitui os dados locais).

### Desinstalar

```bash
sudo ./deploy/uninstall.sh                  # remove o sistema e mantém o banco
sudo ./deploy/uninstall.sh --apagar-banco   # também apaga o banco (faz backup antes)
```

Os backups em `/var/backups/bts-compress` nunca são apagados.

---

## Opção B: Docker

Requer Docker e o plugin `docker compose`. Não precisa configurar banco nem senhas.

```bash
git clone https://github.com/BrunoTv01/bts-compress.git
cd bts-compress
docker compose up -d --build
```

Abra `http://IP-DO-SERVIDOR:3000` e entre com login `admin` e senha `admin`. O sistema pede uma senha nova no primeiro acesso.

Se quiser escolher a senha inicial ou a porta, copie `.env.example` para `.env` e preencha antes do `up`.

```bash
docker compose logs -f app                                              # log
docker compose exec db pg_dump -U bts bts | gzip > bts-backup.sql.gz    # backup
git pull && docker compose up -d --build                                # atualizar
docker compose exec app node tools/reset-password.js                   # admin volta para admin / admin
```

Os dados ficam no volume `bts-db` e não se perdem ao atualizar ou reiniciar.

---

## Problemas comuns

**A página não abre de outro computador.** Confira se a porta está liberada no firewall da rede. O instalador libera no `ufw` e no `firewalld` do próprio servidor, mas não em firewalls externos.

**"Usuário ou senha incorretos".** Um admin pode redefinir a senha na aba **Usuários**. Se ninguém consegue entrar, rode no servidor `sudo /opt/bts-compress/deploy/reset-senha.sh`: o login volta a ser `admin` / `admin`.

**"Muitas tentativas erradas".** Depois de 5 senhas erradas o usuário fica bloqueado por 10 minutos. Espere ou reinicie o serviço com `sudo systemctl restart bts-compress`.

**Usar HTTPS.** Recomendado se o sistema for acessado fora da rede interna. Com `--nginx` instalado, rode `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d seu.dominio`. O cookie de login passa a ser marcado como seguro automaticamente.

**O serviço não sobe.** Rode `sudo journalctl -u bts-compress -n 50`. A primeira linha diz qual banco ele encontrou, ou o que falta. A causa mais comum é o PostgreSQL parado: `sudo systemctl start postgresql`.

**A porta 3000 já está em uso.** Reinstale com outra porta: edite `PORT` em `/etc/bts-compress.env` e reinicie o serviço.
