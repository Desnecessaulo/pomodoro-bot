import { ActivityType, type Client } from 'discord.js';
import { syncAvatar } from '../avatar.js';
import { logger } from '../logger.js';
import type { BotContext } from '../types.js';

export async function onReady(client: Client<true>, ctx: BotContext): Promise<void> {
  logger.info(`Conectado como ${client.user.tag} em ${client.guilds.cache.size} servidor(es).`);
  client.user.setActivity({
    name: 'pomodoro',
    type: ActivityType.Custom,
    state: '🍅 /pomodoro iniciar',
  });
  await ctx.manager.recover();
  await syncAvatar(client, ctx.store);
}
