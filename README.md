# BTS Compress

Sistema web do estudo **BTS Compress (03/08/2026)**: serviços, PIDs e bitrates DVB e ISDB-T, guardados num banco PostgreSQL e editáveis pelo navegador.

## O que tem

- **Serviços & PIDs**: mapa de PIDs decimais de cada serviço e bitrate titular, com a ocupação do mux DVB (32,297 Mbps).
- **DVB atual**: titular x reserva, com a diferença por serviço.
- **DVB antigo**: configuração antiga comparada com a atual.
- **Taxas encoder / mux**: áudio, vídeo e closed caption de cada serviço.
- **ISDB-T**: serviços por layer e taxa medida de cada PID.
- **Serviços**: cadastro de canais (nome, ID, codificação, sistema) escolhendo em quais abas eles entram. Excluir aqui remove o serviço de todas as abas.
- **Incluir e excluir linhas**: no modo edição, cada tabela tem uma barra **+ Incluir** e um botão **Excluir** por linha (com confirmação).
- **Equipamentos**: cadastro de encoders, multiplexadores e outros (nome, fabricante, modelo, função, local, nº de série). O equipamento de cada serviço é escolhido nas abas DVB atual, Taxas e ISDB-T.
- **Login e usuários**: tela de login obrigatória, perfis **Admin** (gerencia usuários), **Editor** (altera dados) e **Leitura** (só consulta). Aba **Usuários** para o Admin.
- **Histórico**: toda alteração, entrada e saída fica registrada com quem fez, valor anterior, novo e horário.

Os totais, sobras e percentuais são recalculados a partir do banco a cada edição.

## Instalar em servidor Linux

Veja **[INSTALL.md](INSTALL.md)**. Resumo:

```bash
git clone https://github.com/BrunoTv01/bts-compress.git && cd bts-compress
sudo ./deploy/install.sh --senha SenhaInicial123
```

Também há uma opção com Docker (`docker compose up -d`).

## Rodar no Render

1. No Render, clique em **New → Blueprint** e escolha este repositório.
2. O `render.yaml` cria o serviço web e o banco PostgreSQL gratuitos.
3. No primeiro start o sistema cria as tabelas e carrega os dados da planilha sozinho.
4. Em **bts-compress → Environment**, o valor de `ADMIN_TOKEN` é a senha inicial do usuário `admin`.

Entre no site com o usuário **admin** e essa senha. O sistema pede uma senha nova no primeiro acesso. Depois, cadastre as outras pessoas na aba **Usuários**.

## Rodar localmente

Precisa de Node.js 20+ e PostgreSQL.

```bash
createdb bts
npm install
DATABASE_URL=postgres://localhost:5432/bts ADMIN_TOKEN=SenhaInicial123 npm start
```

Abra http://localhost:3000.

## Variáveis de ambiente

| Variável       | Uso                                                        |
|----------------|------------------------------------------------------------|
| `DATABASE_URL` | Conexão do PostgreSQL                                      |
| `ADMIN_TOKEN`  | Senha inicial do usuário `admin` (usada só quando ainda não existe nenhum usuário) |
| `PGSSL`        | `true` para conectar com SSL (banco externo ao Render)     |
| `PORT`         | Porta HTTP (o Render define sozinho)                       |

## API

| Método | Rota                    | Descrição                                   |
|--------|-------------------------|---------------------------------------------|
| GET    | `/api/data`             | Todos os dados do estudo                    |
| GET    | `/api/history`          | Últimas 200 alterações                      |
| POST   | `/api/auth/login`       | Entra com `{ username, password }` e recebe o cookie de sessão |
| PATCH  | `/api/:tabela/:id`      | Edita um campo (`{ field, value }`), exige perfil Editor ou Admin |
| GET    | `/api/health`           | Verifica se o banco responde                |

## Banco de dados

O esquema está em `db/schema.sql` e os dados iniciais da planilha em `db/seed.js`.
Para recarregar os dados originais, apague as tabelas e reinicie o serviço.

| Tabela          | Conteúdo                                                    |
|-----------------|-------------------------------------------------------------|
| `services`      | Cadastro de serviços (ID, nome, codificação, sistema)       |
| `service_pids`  | PIDs de vídeo, áudio, PCR, PMT, CC, AIT, ECT, dados         |
| `bitrates`      | Bitrates por configuração: pids_total, titular, reserva, antigo |
| `encoder_rates` | Taxas de encoder e mux                                      |
| `isdb_layers`   | Serviços ISDB-T por layer                                   |
| `isdb_pids`     | PIDs ISDB-T e taxa medida                                   |
| `equipment`     | Cadastro de equipamentos                                    |
| `settings`      | Capacidades (banda DVB, layer B)                            |
| `users`         | Usuários, perfis e senhas (criptografadas com scrypt)       |
| `sessions`      | Sessões de login abertas                                    |
| `audit_log`     | Histórico de alterações, com o usuário que fez              |

## Segurança

- Login obrigatório para ver qualquer dado. Só a página de login e `/api/health` são públicas.
- Senhas guardadas com **scrypt** e sal aleatório; nunca em texto.
- Sessão por cookie `HttpOnly` e `SameSite=Strict`, que expira em 12 h ou após 2 h sem uso. Atrás de HTTPS o cookie é marcado `Secure`.
- Bloqueio de 10 min após 5 senhas erradas no mesmo usuário (ou 20 no mesmo IP).
- Senha nova obrigatória no primeiro acesso e depois de uma redefinição; mínimo de 8 caracteres com letras e números.
- Desativar um usuário ou redefinir a senha dele encerra as sessões abertas na hora.
- Sempre existe pelo menos um Admin ativo; ninguém consegue excluir, desativar ou rebaixar o próprio usuário.
- Todo login, falha de login, troca de senha e alteração de dados vai para o Histórico com o nome do usuário.

Perdeu o acesso de admin? No servidor: `sudo /opt/bts-compress/deploy/reset-senha.sh admin NovaSenha123`.
