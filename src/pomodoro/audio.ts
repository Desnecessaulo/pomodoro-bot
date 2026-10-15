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
  /** Próximos sons a tocar, um após o outro, quando o atual terminar. */
  private queue: string[] = [];

  constructor(
    connection: VoiceConnection,
    private readonly enabled: boolean,
  ) {
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    this.player.on('error', (error) => logger.warn('Falha ao tocar efeito sonoro.', error.message));
    this.player.on(AudioPlayerStatus.Idle, () => {
      logger.debug('Efeito sonoro finalizado.');
      const next = this.queue.shift();
      if (next) this.playNow(next);
    });
    if (enabled) connection.subscribe(this.player);
  }

  /** Toca os arquivos em sequência, interrompendo o que estiver tocando. */
  play(...files: string[]): void {
    if (!this.enabled) return;
    const [first, ...rest] = files;
    if (!first) return;
    this.queue = rest;
    this.playNow(first);
  }

  stop(): void {
    this.queue = [];
    this.player.stop(true);
  }

  private playNow(file: string): void {
    try {
      this.player.play(createAudioResource(file));
    } catch (error) {
      logger.warn(`Não foi possível tocar ${file}.`, error);
    }
  }
}
