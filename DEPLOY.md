# 🚀 Deploy do Pomodoro BOT

O bot é um processo que fica conectado ao Discord 24h (não é um site), então a hospedagem precisa:

- manter o processo **sempre ligado** (sem "dormir" por inatividade);
- ter um **disco persistente** para `data/store.json` (sala configurada e mutes pendentes);
- permitir conexões de saída UDP (voz do Discord) — as opções abaixo permitem.

> ⚠️ **Rode só uma instância do bot por vez.** Antes de ligar o bot na hospedagem, desligue o que está rodando no
> seu computador (feche o terminal com `npm start`/`npm run dev`). Duas instâncias com o mesmo token respondem
> aos mesmos comandos e geram erros.

O projeto já tem um `Dockerfile`, então funciona em qualquer plataforma que rode Docker.

---

## Opção 1 — Railway (recomendado, mais simples)

Faz deploy direto do GitHub e atualiza sozinho a cada `git push`. Custa a partir de US$ 5/mês (plano Hobby;
contas novas recebem crédito de teste).

1. Acesse <https://railway.com> e entre com sua conta do **GitHub**.
2. **New Project** → **Deploy from GitHub repo** → escolha o repositório `pomodoro-bot`.
   Se pedir, autorize o Railway a acessar o repositório (ele é privado).
   O Railway detecta o `Dockerfile` automaticamente.
3. Abra o serviço criado → aba **Variables** → adicione:

   | Variável            | Valor                                                         |
   | ------------------- | ------------------------------------------------------------- |
   | `DISCORD_TOKEN`     | o token do bot                                                |
   | `DISCORD_CLIENT_ID` | `1560037765310320750`                                         |
   | `RAILWAY_RUN_UID`   | `0` (permite gravar no volume, que o Railway monta como root) |

   Opcionais: `POMODORO_MINUTES`, `RESPONSE_TIMEOUT_MINUTES`, `SOUNDS_ENABLED`, `LOG_LEVEL`.

4. Crie o disco persistente: no canvas do projeto, clique com o botão direito no serviço (ou `Ctrl+K`) →
   **Add Volume** → **Mount path**: `/app/data`.
5. O Railway faz o deploy. Em **Deployments → View logs** deve aparecer:
   `Conectado como Pomodoro BOT#4908 em N servidor(es).`
6. Não é preciso gerar domínio público nem configurar porta — o bot não recebe acessos HTTP.

**Atualizar o bot:** faça as alterações, `git commit` e `git push`. O Railway refaz o deploy sozinho. Ao desligar
a versão antiga, o bot recebe `SIGTERM` e desmuta todos antes de sair.

---

## Opção 2 — VPS própria com Docker (Oracle Cloud Free, Hetzner, DigitalOcean, Contabo...)

Mais trabalho para configurar, mas pode ser gratuita (Oracle Cloud _Always Free_) ou bem barata. Exemplo para
Ubuntu:

```bash
# 1. Instalar Docker e Git
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get install -y git

# 2. Baixar o código (repositório privado: autentique com `gh auth login` ou um token de acesso)
git clone https://github.com/SEU_USUARIO/pomodoro-bot.git
cd pomodoro-bot

# 3. Criar o .env com o token
cp .env.example .env
nano .env        # preencha DISCORD_TOKEN e DISCORD_CLIENT_ID

# 4. Construir e rodar (reinicia sozinho se cair ou se a VPS reiniciar)
sudo docker build -t pomodoro-bot .
sudo docker run -d --name pomodoro-bot --restart unless-stopped \
  --env-file .env -v pomodoro-data:/app/data pomodoro-bot

# Ver os logs
sudo docker logs -f pomodoro-bot
```

**Atualizar o bot:**

```bash
cd pomodoro-bot && git pull
sudo docker build -t pomodoro-bot .
sudo docker rm -f pomodoro-bot
sudo docker run -d --name pomodoro-bot --restart unless-stopped \
  --env-file .env -v pomodoro-data:/app/data pomodoro-bot
```

O volume `pomodoro-data` mantém a configuração entre atualizações.

---

## Depois do primeiro deploy

- Os slash commands **já estão registrados** no Discord (são globais e ficam salvos no Discord, não na
  hospedagem). Só rode `npm run deploy` de novo — no seu computador, com o `.env` local — se alterar a
  definição de algum comando (nome, descrição, opções).
- A configuração da sala fica no disco da hospedagem, que começa vazio: rode **`/config sala`** de novo no
  servidor.
- Troque o token se ele tiver sido exposto: Developer Portal → **Bot** → **Reset Token**, e atualize a variável
  `DISCORD_TOKEN` na hospedagem (e no `.env` local).

## Problemas comuns

| Sintoma                                            | Causa provável / solução                                  |
| -------------------------------------------------- | --------------------------------------------------------- |
| `TokenInvalid` nos logs                            | `DISCORD_TOKEN` errado ou trocado — confira a variável    |
| `Variável de ambiente obrigatória ausente`         | Faltou `DISCORD_TOKEN` ou `DISCORD_CLIENT_ID`             |
| `EACCES` ao salvar o armazenamento                 | No Railway, faltou `RAILWAY_RUN_UID=0`                    |
| Comandos respondem duas vezes / erros de interação | Há duas instâncias rodando — desligue a do seu computador |
| Bot esquece a sala após cada deploy                | Volume não montado em `/app/data`                         |
