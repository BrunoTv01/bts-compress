# Instalar no Windows 10/11

Instala direto no Windows, sem máquina virtual: Node.js, PostgreSQL e o BTS Compress.

## Instalar

1. Baixe **Instalar-BTS-Compress.bat**.
2. Dê **dois cliques** nele.
   - Se aparecer "O Windows protegeu o computador": **Mais informações → Executar assim mesmo**.
   - Clique em **Sim** quando pedir permissão de administrador.
3. Espere (10 a 15 min na primeira vez; precisa de internet).
4. O navegador abre sozinho em **http://localhost:3000**. Entre com **admin / admin**; o sistema pede uma senha nova.

Fica um atalho **BTS Compress** na Área de Trabalho, e o sistema liga sozinho junto com o Windows.

## Atualizar

Dois cliques no mesmo **Instalar-BTS-Compress.bat**. Ele faz backup do banco, atualiza e mantém os dados.

## Onde fica cada coisa

| Item | Local |
|---|---|
| Sistema | `C:\BTS-Compress\app` |
| Configuração (porta, banco) | `C:\BTS-Compress\app\.env` |
| Log | `C:\BTS-Compress\logs\bts-compress.log` |
| Backups (feitos a cada atualização) | `C:\BTS-Compress\backups` |
| Senha do superusuário do PostgreSQL | `C:\BTS-Compress\postgres-superusuario.txt` (só administradores) |
| Tarefa que liga o sistema | Agendador de Tarefas → **BTS Compress** |

## Acesso de outros computadores

O instalador libera a porta 3000 no firewall para redes privadas e de domínio. Os outros computadores acessam por `http://IP-DESTE-COMPUTADOR:3000` (o endereço aparece no final da instalação).

## Desinstalar

Dois cliques em **Desinstalar-BTS-Compress.bat**. O banco e os backups são mantidos.

## Problemas comuns

- **"winget não foi encontrado"**: abra a Microsoft Store, procure **Instalador de Aplicativo** e atualize. Depois rode de novo.
- **PostgreSQL já instalado antes**: o instalador precisa da senha do usuário `postgres`. Crie o arquivo `C:\BTS-Compress\postgres-superusuario.txt` com essa senha e rode de novo.
- **Esqueceu a senha do admin**: no PowerShell como administrador, `cd C:\BTS-Compress\app` e `node tools\reset-password.js` (volta para admin / admin).
