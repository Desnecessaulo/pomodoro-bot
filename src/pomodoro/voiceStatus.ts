import type { Client } from 'discord.js';
import { logger } from '../logger.js';

/**
 * Define o status de uma sala de voz (texto exibido abaixo do nome da sala). Uma string
 * vazia limpa o status. O discord.js ainda não expõe esse endpoint, então usamos o REST
 * direto. Requer a permissão "Definir status do canal de voz" e o bot conectado à sala.
 */
export async function setVoiceChannelStatus(
  client: Client,
  channelId: string,
  status: string,
): Promise<boolean> {
  try {
    await client.rest.put(`/channels/${channelId}/voice-status`, {
      body: { status },
      reason: 'Pomodoro BOT',
    });
    return true;
  } catch (error) {
    logger.warn(
      `Não consegui ${status ? 'definir' : 'limpar'} o status da sala ${channelId}.`,
      (error as Error).message,
    );
    return false;
  }
}
