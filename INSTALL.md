# Instalação em servidor Linux

Duas formas de instalar. Escolha uma.

| | Opção A: script (recomendado) | Opção B: Docker |
|---|---|---|
| Para quem | Servidor Linux dedicado ou VM | Quem já usa Docker |
| Sistemas | Ubuntu 22.04+, Debian 12+, Rocky/Alma/RHEL 9 | Qualquer Linux com Docker |
| Instala | Node.js 22, PostgreSQL, serviço systemd, nginx (opcional) | Dois contêineres: sistema e PostgreSQL |

Requisitos mínimos: 1 CPU, 1 GB de RAM, 2 GB de disco e acesso à internet durante a instalação (para baixar Node.js, PostgreSQL e as duas bibliotecas do sistema).

Versão atual: **1.1.0**, com login de usuários, perfis, cadastro de serviços e equipamentos, inclusão e exclusão de linhas e a tela de entrada animada.

---

## Opção A: script de instalação

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

Se o servidor não tiver acesso ao GitHub, copie o arquivo `bts-compress-1.1.0.tar.gz` para ele (por `scp` ou pendrive) e extraia:

```bash
tar xzf bts-compress-1.1.0.tar.gz
cd bts-compress
```

### 2. Rode o instalador

```bash
sudo ./deploy/install.sh --senha SenhaInicial123
```

No final aparecem o endereço do sistema, o login `admin` e a senha inicial. Se você não passar `--senha`, uma senha é gerada e mostrada.

### 3. Primeiro acesso

1. Abra o endereço no navegador e entre com o usuário **admin** e a senha inicial.
2. O sistema pede uma senha nova, só sua.
3. Na aba **Usuários**, cadastre as outras pessoas com o perfil certo:
   - **Leitura**: só consulta.
   - **Editor**: inclui, exclui e altera dados.
   - **Admin**: tudo isso e também gerencia usuários.

Cada pessoa recebe uma senha provisória e cria a própria senha no primeiro acesso.

Opções do instalador:

| Opção | O que faz |
|---|---|
| `--senha S` | Senha inicial do usuário `admin`. Em uma reinstalação, redefine a senha do `admin` |
| `--porta N` | Porta do sistema (padrão 3000) |
| `--nginx` | Publica na porta 80 através do nginx. O sistema passa a aceitar conexões só pelo nginx |
| `--dominio nome` | Nome do servidor no nginx, por exemplo `bts.cultura.local` |
| `--sem-banco` | Usa um PostgreSQL que já existe. Defina `DATABASE_URL` antes de rodar |

Exemplos:

```bash
# na porta 80, com nginx
sudo ./deploy/install.sh --nginx --senha SuaSenha

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
sudo /opt/bts-compress/deploy/reset-senha.sh admin NovaSenha123   # recuperar acesso de um usuário
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
cd bts-compress
git pull                      # ou extraia o .tar.gz novo
sudo ./deploy/update.sh
```

O `update.sh` faz backup do banco, copia os arquivos novos e reinicia. Mudanças na estrutura do banco são aplicadas sozinhas, sem perder dados.

**Vindo de uma versão sem login (1.0):** depois do `update.sh`, a tela de login aparece. Entre com o usuário `admin` e a mesma senha que você usava para editar (a do `--senha` da instalação). O sistema pede uma senha nova e, a partir daí, você cadastra as outras pessoas na aba **Usuários**. Para ver a senha antiga: `sudo grep ADMIN_TOKEN /etc/bts-compress.env`.

### Desinstalar

```bash
sudo ./deploy/uninstall.sh                  # remove o sistema e mantém o banco
sudo ./deploy/uninstall.sh --apagar-banco   # também apaga o banco (faz backup antes)
```

Os backups em `/var/backups/bts-compress` nunca são apagados.

---

## Opção B: Docker

Requer Docker e o plugin `docker compose`.

```bash
git clone https://github.com/BrunoTv01/bts-compress.git
cd bts-compress
cp .env.example .env
nano .env                  # troque DB_PASSWORD e ADMIN_TOKEN (senha inicial do admin)
docker compose up -d --build
```

Abra `http://IP-DO-SERVIDOR:3000` e entre com o usuário `admin` e a senha que você pôs em `ADMIN_TOKEN`.

Para recuperar o acesso: `docker compose exec app node tools/reset-password.js admin NovaSenha123`.

```bash
docker compose logs -f app                                              # log
docker compose exec db pg_dump -U bts bts | gzip > bts-backup.sql.gz    # backup
git pull && docker compose up -d --build                                # atualizar
```

Os dados ficam no volume `bts-db` e não se perdem ao atualizar ou reiniciar.

---

## Problemas comuns

**A página não abre de outro computador.** Confira se a porta está liberada no firewall da rede. O instalador libera no `ufw` e no `firewalld` do próprio servidor, mas não em firewalls externos.

**"Usuário ou senha incorretos".** Um admin pode redefinir a senha na aba **Usuários**. Se ninguém consegue entrar, use no servidor `sudo /opt/bts-compress/deploy/reset-senha.sh admin NovaSenha123`.

**"Muitas tentativas erradas".** Depois de 5 senhas erradas o usuário fica bloqueado por 10 minutos. Espere ou reinicie o serviço com `sudo systemctl restart bts-compress`.

**Usar HTTPS.** Recomendado se o sistema for acessado fora da rede interna. Com `--nginx` instalado, rode `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d seu.dominio`. O cookie de login passa a ser marcado como seguro automaticamente.

**O serviço não sobe.** Rode `sudo journalctl -u bts-compress -n 50`. A causa mais comum é o PostgreSQL parado: `sudo systemctl start postgresql`.

**A porta 3000 já está em uso.** Reinstale com outra porta: edite `PORT` em `/etc/bts-compress.env` e reinicie o serviço.
