# Instalar com um clique (Ubuntu com tela gráfica)

1. Baixe o arquivo **Instalar-BTS-Compress.desktop** e deixe na Área de Trabalho ou em Downloads.
2. Clique nele com o **botão direito → "Permitir execução"** (*Allow Launching*). Só na primeira vez.
3. Dê **dois cliques** nele.
4. Abre uma janela do terminal. Digite a **senha do seu usuário** quando pedir e espere (5 a 10 min, precisa de internet).
5. No final o navegador abre sozinho em **http://localhost:3000**. Entre com **admin / admin**.

O mesmo ícone também **atualiza** o sistema quando já estiver instalado.

Em servidor sem tela gráfica, use o comando equivalente:

```bash
curl -fsSL https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/instalar.sh | sudo bash
```
