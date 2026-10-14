import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { logger } from '../logger.js';

/** Toca efeitos sonoros curtos na sala; falhas nunca interrompem o Pomodoro. */
export class SoundPlayer {
  private readonly player: AudioPlayer;

  constructor(
    connection: VoiceConnection,
    private readonly enabled: boolean,
  ) {
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    this.player.on('error', (error) => logger.warn('Falha ao tocar efeito sonoro.', error.message));
    this.player.on(AudioPlayerStatus.Idle, () => logger.debug('Efeito sonoro finalizado.'));
    if (enabled) connection.subscribe(this.player);
  }

  play(file: string): void {
    if (!this.enabled) return;
    try {
      this.player.play(createAudioResource(file));
    } catch (error) {
      logger.warn(`Não foi possível tocar ${file}.`, error);
    }
  }

  stop(): void {
    this.player.stop(true);
  }
}
