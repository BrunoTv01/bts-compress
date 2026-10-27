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
- **Coleta RTP**: recebe o stream do mux DVB, do BTS ISDB-T ou de um encoder (RTP ou UDP, multicast ou unicast), lê PAT, PMT e SDT e mede a taxa de cada PID e a layer ISDB-T. Mostra o que está diferente do banco e grava só o que você marcar (veja abaixo).
- **Histórico**: toda alteração, entrada e saída fica registrada com quem fez, valor anterior, novo e horário.

Os totais, sobras e percentuais são recalculados a partir do banco a cada edição.

## Coleta RTP

Aba **Coleta RTP** (perfis Editor e Admin):

1. **Cadastre o stream**: nome, tipo (Mux DVB, BTS ISDB-T ou saída de encoder), endereço multicast e porta (ex.: `239.1.1.1` e `5000`), placa de rede e o que essa coleta pode preencher.
2. **Clique em Coletar**: o sistema escuta o stream de 5 a 60 segundos.
3. **Revise**: aparecem os serviços encontrados (com PMT, PCR, componentes, taxa e layer) e a lista de diferenças entre o stream e o banco, aba por aba.
4. **Grave**: marque o que quer gravar e clique em **Gravar**. Cada valor vai para o Histórico com o seu nome e a data da medição.

O que a coleta preenche:

| Aba | Dados |
|---|---|
| Serviços & PIDs | ID de serviço, codificação, PIDs (vídeo, áudios, PCR, PMT, CC, AIT, DEM, ECT, dados) e bitrate do serviço |
| DVB atual | bitrate titular ou reserva, e o encoder escolhido no stream |
| Taxas encoder / mux | áudios e CC em kbps, vídeo em Mbps |
| ISDB-T | bitrate e layer de cada serviço, linha de tabelas, capacidade da layer B e taxa de cada PID |

Serviços que estão no stream mas não no cadastro aparecem como **novo** e podem ser cadastrados na hora. O serviço do stream é ligado ao do cadastro pelo PID da PMT, depois pelo ID de serviço e por fim pelo nome.

O servidor precisa estar na mesma rede do multicast (numa VM, placa em modo **Bridge**). O instalador libera UDP multicast no firewall. No Docker, a coleta só recebe multicast com `network_mode: host`.

Pelo terminal do servidor:

```bash
node /opt/bts-compress/tools/analisar-rtp.js 239.1.1.1:5000 --segundos 10     # mede e mostra o resultado
node /opt/bts-compress/tools/enviar-rtp.js arquivo.ts 239.1.1.1:5000 --mbps 32.297 --repetir   # gera um stream de teste a partir de um .ts
```

## Instalar em servidor Linux

Um comando só, no terminal do servidor. Ele baixa o sistema, instala o PostgreSQL local, cria o banco e deixa tudo rodando:

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash
```

No Ubuntu com tela gráfica dá para instalar **com um clique**: baixe [deploy/clique/Instalar-BTS-Compress.desktop](deploy/clique/LEIA-ME.md), permita a execução e dê dois cliques.

O mesmo comando também **atualiza** um sistema já instalado, com backup antes e sem perder dados. Detalhes em **[INSTALL.md](INSTALL.md)**.

Depois abra o endereço mostrado e entre com **login `admin` e senha `admin`**. O sistema pede uma senha nova no primeiro acesso.

Também há uma opção com Docker (`docker compose up -d`) uma **ISO para máquina virtual** ([deploy/iso](deploy/iso/LEIA-ME.md)) e um **criador de VM no VirtualBox** com dois cliques ([deploy/vm](deploy/vm/LEIA-ME.md)).

## Instalar no Windows

Dois cliques em **[deploy/windows/Instalar-BTS-Compress.bat](deploy/windows/LEIA-ME.md)**. Instala Node.js, PostgreSQL e o sistema direto no Windows 10/11, liga junto com o Windows e cria o atalho na Área de Trabalho.

## Baixar

| O quê | Link |
|---|---|
| Sistema completo (.zip, para Windows ou pendrive) | https://github.com/BrunoTv01/bts-compress/archive/refs/heads/main.zip |
| Sistema completo (.tar.gz, para Linux) | https://github.com/BrunoTv01/bts-compress/archive/refs/heads/main.tar.gz |
| Só o instalador de um comando | https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh |

Depois de baixar o pacote, no servidor Linux:

```bash
tar xzf bts-compress-main.tar.gz      # ou: unzip bts-compress-main.zip
cd bts-compress-main
sudo ./deploy/install.sh
```

## Rodar no Render

1. No Render, clique em **New → Blueprint** e escolha este repositório.
2. O `render.yaml` cria o serviço web e o banco PostgreSQL gratuitos.
3. No primeiro start o sistema cria as tabelas e carrega os dados da planilha sozinho.
4. Em **bts-compress → Environment**, o valor de `ADMIN_TOKEN` é a senha inicial do usuário `admin`.

Entre no site com o usuário **admin** e essa senha. O sistema pede uma senha nova no primeiro acesso. Depois, cadastre as outras pessoas na aba **Usuários**.

O `ADMIN_TOKEN` só vale na primeira vez que o banco é criado. Mudar essa variável depois não muda a senha.

**Senha incorreta no Render?** O plano gratuito não tem terminal, então a senha é redefinida pelo painel:

1. Em **bts-compress → Environment**, adicione a variável `ADMIN_RESET_PASSWORD` com uma senha nova (8+ caracteres, letras e números, sem a palavra "admin").
2. Salve. O Render reinicia o serviço e a senha do `admin` passa a ser essa.
3. Entre com **admin** e a senha nova e crie a sua senha definitiva.
4. Apague `ADMIN_RESET_PASSWORD` do painel. Cada valor só é aplicado uma vez; para redefinir de novo, use um valor diferente.

**Levar os dados do Render para o servidor local:** `sudo /opt/bts-compress/deploy/importar-banco.sh "EXTERNAL_DATABASE_URL"` (veja INSTALL.md).

## Rodar sem configurar o banco

O sistema encontra o PostgreSQL sozinho. Basta ter o PostgreSQL instalado na máquina:

```bash
sudo apt install postgresql nodejs npm     # Ubuntu/Debian
npm install
sudo npm start
```

Na primeira vez ele cria o usuário e o banco `bts` com uma senha aleatória, carrega a planilha e cria o usuário `admin` com senha `admin`. A configuração fica salva no arquivo `.env` da pasta, e nas próximas vezes ele já sabe onde está o banco.

Como o sistema procura o banco, nesta ordem:

1. `DATABASE_URL`, se tiver sido informado (Render, Docker, outro servidor).
2. Arquivo `.env` da pasta do sistema ou `/etc/bts-compress.env` (criado pelo instalador).
3. PostgreSQL da própria máquina pelo socket local, sem senha.
4. Se nada disso funcionar e estiver rodando como root, cria o usuário e o banco `bts` e salva em `.env`.

Se não achar nenhum PostgreSQL, ele mostra o que instalar.

Abra http://localhost:3000.

## Variáveis de ambiente

| Variável       | Uso                                                        |
|----------------|------------------------------------------------------------|
| `DATABASE_URL` | Opcional. Conexão do PostgreSQL; sem ela o sistema procura e configura o banco sozinho |
| `ADMIN_TOKEN`  | Opcional. Outra senha inicial para o `admin`; sem ela a senha inicial é `admin` |
| `ADMIN_RESET_PASSWORD` | Opcional. Redefine a senha do `admin` ao iniciar. Use para recuperar o acesso e apague depois |
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
| `stream_sources` | Streams cadastrados na Coleta RTP (endereço, porta, placa, abas) |
| `stream_measurements` | Medições feitas, com o resultado completo da análise    |

## Segurança

- Login obrigatório para ver qualquer dado. Só a página de login e `/api/health` são públicas.
- Senhas guardadas com **scrypt** e sal aleatório; nunca em texto.
- Sessão por cookie `HttpOnly` e `SameSite=Strict`, que expira em 12 h ou após 2 h sem uso. Atrás de HTTPS o cookie é marcado `Secure`.
- Bloqueio de 10 min após 5 senhas erradas no mesmo usuário (ou 20 no mesmo IP).
- Toda instalação nova começa com login `admin` e senha `admin`. Essa senha só serve uma vez: no primeiro acesso o sistema exige uma senha nova, e a padrão deixa de funcionar.
- Senha nova obrigatória no primeiro acesso e depois de uma redefinição; mínimo de 8 caracteres com letras e números.
- Desativar um usuário ou redefinir a senha dele encerra as sessões abertas na hora.
- Sempre existe pelo menos um Admin ativo; ninguém consegue excluir, desativar ou rebaixar o próprio usuário.
- Todo login, falha de login, troca de senha e alteração de dados vai para o Histórico com o nome do usuário.

Perdeu o acesso de admin? No servidor: `sudo /opt/bts-compress/deploy/reset-senha.sh` volta o login para `admin` / `admin` (com troca obrigatória no próximo acesso). No Render, use a variável `ADMIN_RESET_PASSWORD` (veja “Rodar no Render”).
