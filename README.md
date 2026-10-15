# 🍅 Pomodoro BOT

Bot de Discord que conduz sessões Pomodoro em uma sala de voz:

- Entra na sala de voz configurada e **muta (mute de servidor) todos** por 25 minutos (ou o tempo escolhido, até 59).
- Quem **entrar na sala durante o Pomodoro** é mutado automaticamente.
- Muda o **próprio apelido** a cada 5 minutos para mostrar quanto falta: `Pomodoro: 25m` → `20m` → `15m` → `10m` → `5m`, e volta ao normal no fim.
- Toca `orb.mp3` no início, **a cada 10 minutos** e quando faltam 5 minutos; toca `levelup.mp3` quando o Pomodoro acaba.
- O anúncio no chat mostra os **minutos restantes** (atualizados a cada minuto) e o **horário de término** (horário de Brasília), com os botões **Encerrar** e **Pausa e +1 Pomodoro**.
- **Pausa e +1 Pomodoro** (só para Pomodoros de 25 min ou mais): no fim do foco começa uma pausa — 5 min para Pomodoros de 25 a 49 min, 10 min para 50 a 59 min — e, depois dela, outro Pomodoro com a mesma duração começa sozinho.
  - Na pausa, todos são desmutados, o apelido vira `Pomodoro PAUSA: 5m`, o status da sala vira `POMODORO PAUSA ☕` e o anúncio passa a mostrar a pausa.
  - Sons: `levelup.mp3` seguido de `smw_pause.wav` no início da pausa, `smw_princess_help.wav` faltando 1 minuto e `orb.mp3` quando o próximo Pomodoro começa.
- Sem pausa agendada, no fim **desmuta todos** e pergunta no chat se querem começar outro (botão **Iniciar outro**).
- Se ninguém responder em **2 minutos**, sai da sala.
- Muda o **status da sala de voz** para `POMODORO ROLANDO 🍅` durante o foco (sobrescrevendo qualquer status anterior) e limpa ao acabar.
- Usa `assets/icone.png` como **foto de perfil**.

## Comandos

| Comando                       | Quem pode usar                            | O que faz                                               |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `/config sala`                | Quem tem _Gerenciar servidor_             | Define a sala de voz do Pomodoro                        |
| `/config ver`                 | Quem tem _Gerenciar servidor_             | Mostra a sala configurada                               |
| `/pomodoro iniciar [minutos]` | Quem está na sala do Pomodoro             | Entra na sala e começa o Pomodoro (1–59 min, padrão 25) |
| `/pomodoro parar`             | Quem iniciou, quem está na sala ou admins | Encerra, desmuta todos e sai da sala                    |
| `/pomodoro status`            | Todos                                     | Mostra quanto tempo falta                               |

As mensagens do Pomodoro são enviadas no canal de texto em que `/pomodoro iniciar` foi usado.

Regras do `/pomodoro iniciar`:

- Só funciona para quem **está na sala de voz do Pomodoro**; caso contrário o bot avisa que a pessoa não está na sala certa e não faz nada.
- Se já houver um Pomodoro (ou uma pausa) **em andamento**, não é possível iniciar outro — o bot avisa e mostra quando o atual termina.
- Depois que um Pomodoro acaba (enquanto o bot pergunta se querem outro), `/pomodoro iniciar` ou o botão **Iniciar outro** iniciam o próximo. O botão repete a duração anterior.
- Os avisos de erro aparecem só para quem usou o comando.

## Configuração

### 1. Criar o bot no Discord

1. Acesse o [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → nome **Pomodoro BOT**.
2. Em **Bot**, defina o username como `Pomodoro BOT`, clique em **Reset Token** e copie o token.
   A foto de perfil é aplicada automaticamente pelo bot a partir de `assets/icone.png` (para trocá-la, substitua o
   arquivo e reinicie o bot — ele só reenvia quando a imagem muda, pois o Discord limita trocas de avatar).
3. Em **General Information**, copie o **Application ID**.
4. Nenhuma _Privileged Gateway Intent_ é necessária.

### 2. Convidar o bot

Troque `SEU_APPLICATION_ID` e abra o link:

```
https://discord.com/oauth2/authorize?client_id=SEU_APPLICATION_ID&scope=bot+applications.commands&permissions=281475051162624
```

Permissões incluídas: Ver canais, Enviar mensagens, Conectar, Falar, **Silenciar membros**, **Alterar apelido** e **Definir status do canal de voz**.
Se a sala tiver permissões próprias, garanta que o bot tenha _Conectar_, _Silenciar membros_ e _Definir status do canal de voz_ nela.

### 3. Rodar o projeto

Requisitos: Node.js 22.12 ou superior.

```bash
npm install
cp .env.example .env      # no Windows: copy .env.example .env
# edite o .env com DISCORD_TOKEN e DISCORD_CLIENT_ID
npm run deploy            # registra os slash commands (rode de novo se alterá-los)
npm run dev               # desenvolvimento (recarrega ao salvar)
```

Produção:

```bash
npm run build
npm start
```

Para colocar o bot online 24h (Railway ou VPS com Docker), veja o **[DEPLOY.md](DEPLOY.md)**.

> Dica: durante o desenvolvimento, preencha `DEV_GUILD_ID` para que `npm run deploy` registre os comandos
> só no seu servidor, e eles apareçam na hora. Para testar rápido, use `POMODORO_MINUTES=1`.

## Variáveis de ambiente

| Variável                   | Padrão | Descrição                                                 |
| -------------------------- | ------ | --------------------------------------------------------- |
| `DISCORD_TOKEN`            | —      | Token do bot (obrigatório)                                |
| `DISCORD_CLIENT_ID`        | —      | Application ID (obrigatório)                              |
| `DEV_GUILD_ID`             | —      | Servidor para registrar comandos instantaneamente         |
| `POMODORO_MINUTES`         | `25`   | Duração padrão quando `minutos` não é informado (máx. 59) |
| `RESPONSE_TIMEOUT_MINUTES` | `2`    | Tempo de espera pela resposta antes de sair               |
| `SOUNDS_ENABLED`           | `true` | Liga os efeitos sonoros (foco, fim e pausa)               |
| `LOG_LEVEL`                | `info` | `debug`, `info`, `warn` ou `error`                        |

## Comportamento e garantias

- **Só desmuta quem o bot mutou.** Quem já estava mutado por um moderador continua mutado.
- **Ninguém fica mutado para sempre.** O mute de servidor do Discord continua mesmo fora da sala; por isso o
  bot salva em `data/store.json` quem ele mutou. Quem sair para outra sala é desmutado na hora; quem
  desconectar é desmutado assim que entrar em qualquer sala de voz do servidor.
- **Resistente a quedas.** Ao reiniciar, o bot desfaz mutes pendentes e restaura o próprio apelido. Ao
  receber `Ctrl+C`/`SIGTERM`, encerra os Pomodoros de forma limpa antes de sair.
- Durante o foco, se alguém da sala for desmutado manualmente, o bot muta de novo. Para liberar todos,
  use `/pomodoro parar`.
- Se o bot for desconectado ou movido da sala, o Pomodoro é encerrado e todos são desmutados.
- Para trocar os sons, substitua os arquivos em `assets/sounds/` (qualquer formato suportado pelo FFmpeg).

## Estrutura

```
src/
├── index.ts                  # Bootstrap do cliente, eventos e desligamento seguro
├── config.ts                 # Variáveis de ambiente validadas e constantes
├── commands/                 # Slash commands (/config, /pomodoro)
├── events/                   # Handlers de ready e interactionCreate
├── pomodoro/
│   ├── PomodoroManager.ts    # Uma sessão por servidor; reage a entradas/saídas da sala
│   ├── PomodoroSession.ts    # Ciclos de foco e pausa, timers, apelido, botões e conexão de voz
│   ├── MuteService.ts        # Mute/desmute com registro persistente
│   ├── audio.ts              # Efeitos sonoros
│   └── time.ts               # Cálculo dos apelidos e formatação (com testes)
├── storage/GuildStore.ts     # Armazenamento JSON com escrita atômica
└── scripts/deploy-commands.ts
```

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm run deploy` · `npm test` · `npm run lint` · `npm run typecheck` · `npm run format`
