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
- **Histórico**: toda alteração feita pelo sistema fica registrada (valor anterior, novo e horário).

Os totais, sobras e percentuais são recalculados a partir do banco a cada edição.

## Instalar em servidor Linux

Veja **[INSTALL.md](INSTALL.md)**. Resumo:

```bash
git clone https://github.com/BrunoTv01/bts-compress.git && cd bts-compress
sudo ./deploy/install.sh --senha SuaSenha
```

Também há uma opção com Docker (`docker compose up -d`).

## Rodar no Render

1. No Render, clique em **New → Blueprint** e escolha este repositório.
2. O `render.yaml` cria o serviço web e o banco PostgreSQL gratuitos.
3. No primeiro start o sistema cria as tabelas e carrega os dados da planilha sozinho.
4. Defina a senha de edição em **bts-compress → Environment → ADMIN_TOKEN** e salve.

No site, clique em **Editar valores**, informe a senha e clique em qualquer valor sublinhado para alterar.

## Rodar localmente

Precisa de Node.js 20+ e PostgreSQL.

```bash
createdb bts
npm install
DATABASE_URL=postgres://localhost:5432/bts ADMIN_TOKEN=minha-senha npm start
```

Abra http://localhost:3000.

## Variáveis de ambiente

| Variável       | Uso                                                        |
|----------------|------------------------------------------------------------|
| `DATABASE_URL` | Conexão do PostgreSQL                                      |
| `ADMIN_TOKEN`  | Senha de edição. Sem ela, o sistema fica só leitura        |
| `PGSSL`        | `true` para conectar com SSL (banco externo ao Render)     |
| `PORT`         | Porta HTTP (o Render define sozinho)                       |

## API

| Método | Rota                    | Descrição                                   |
|--------|-------------------------|---------------------------------------------|
| GET    | `/api/data`             | Todos os dados do estudo                    |
| GET    | `/api/history`          | Últimas 200 alterações                      |
| PATCH  | `/api/:tabela/:id`      | Edita um campo (`{ field, value }`), exige `Authorization: Bearer <ADMIN_TOKEN>` |
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
| `audit_log`     | Histórico de alterações                                     |
