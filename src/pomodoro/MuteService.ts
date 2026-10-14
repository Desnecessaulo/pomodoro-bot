import { DiscordAPIError, RESTJSONErrorCodes, type VoiceState } from 'discord.js';
import { logger } from '../logger.js';
import type { GuildStore } from '../storage/GuildStore.js';

/**
 * Centraliza o mute/desmute de servidor. Só desmuta quem o próprio bot mutou, e registra
 * isso em disco para desmutar depois quem saiu da chamada (ou se o bot reiniciar).
 */
export class MuteService {
  constructor(private readonly store: GuildStore) {}

  async mute(state: VoiceState): Promise<void> {
    if (state.serverMute) return;
    const { guild, id } = state;
    // Registra antes de mutar: se o bot cair no meio do caminho, a pessoa ainda será desmutada.
    await this.store.addMuted(guild.id, id);
    try {
      await state.setMute(true, 'Pomodoro em andamento');
      logger.debug(`Mutado ${id} em ${guild.id}.`);
    } catch (error) {
      await this.store.removeMuted(guild.id, id);
      logger.warn(`Não consegui mutar ${id} em ${guild.name}.`, describe(error));
    }
  }

  /** Desmuta alguém mutado pelo bot, se a pessoa estiver conectada a alguma sala de voz. */
  async release(state: VoiceState): Promise<void> {
    const { guild, id } = state;
    if (!state.channelId || !this.store.isMutedByBot(guild.id, id)) return;
    try {
      if (state.serverMute) await state.setMute(false, 'Pomodoro finalizado');
      await this.store.removeMuted(guild.id, id);
      logger.debug(`Desmutado ${id} em ${guild.id}.`);
    } catch (error) {
      // Se a pessoa saiu da chamada, fica pendente e será desmutada quando voltar.
      if (isCode(error, RESTJSONErrorCodes.TargetUserIsNotConnectedToVoice)) return;
      logger.warn(`Não consegui desmutar ${id} em ${guild.name}.`, describe(error));
    }
  }
}

function isCode(error: unknown, code: number): boolean {
  return error instanceof DiscordAPIError && error.code === code;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
