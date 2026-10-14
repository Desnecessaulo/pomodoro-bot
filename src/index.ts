import { Client, Events, GatewayIntentBits } from 'discord.js';
import { DATA_FILE, loadConfig } from './config.js';
import { onInteractionCreate } from './events/interactionCreate.js';
import { onReady } from './events/ready.js';
import { logger } from './logger.js';
import { PomodoroManager } from './pomodoro/PomodoroManager.js';
import { GuildStore } from './storage/GuildStore.js';
import type { BotContext } from './types.js';

const config = loadConfig();
const store = new GuildStore(DATA_FILE);
await store.load();

const client = new Client({
  // Sem intents privilegiadas: slash commands + estados de voz bastam.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  // Menções nas mensagens do bot não notificam ninguém.
  allowedMentions: { parse: [], repliedUser: false },
});

const manager = new PomodoroManager(client, config, store);
const ctx: BotContext = { config, store, manager };

client.once(Events.ClientReady, (readyClient) => {
  onReady(readyClient, ctx).catch((error) => logger.error('Erro no evento ready.', error));
});
client.on(Events.InteractionCreate, (interaction) => {
  void onInteractionCreate(interaction, ctx);
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  manager
    .handleVoiceStateUpdate(oldState, newState)
    .catch((error) => logger.error('Erro ao processar mudança de voz.', error));
});
client.on(Events.Error, (error) => logger.error('Erro do cliente Discord.', error));
client.on(Events.Warn, (message) => logger.warn(message));

process.on('unhandledRejection', (reason) =>
  logger.error('Promise rejeitada sem tratamento.', reason),
);

// Ao desligar, desmuta todos e restaura o apelido antes de sair.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Recebido ${signal}, encerrando...`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  await manager.shutdown();
  await client.destroy();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await client.login(config.token);
