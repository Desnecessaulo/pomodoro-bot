import {
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type VoiceConnection,
} from '@discordjs/voice';
import {
  PermissionFlagsBits,
  type BaseMessageOptions,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type VoiceBasedChannel,
  type VoiceState,
} from 'discord.js';
import {
  FOCUS_SOUND_INTERVAL_MS,
  NICKNAME_FINAL_WARNING_MS,
  NICKNAME_UPDATE_INTERVAL_MS,
  SOUNDS,
  VOICE_STATUS_TEXT,
  type AppConfig,
} from '../config.js';
import { logger } from '../logger.js';
import type { GuildStore } from '../storage/GuildStore.js';
import { SoundPlayer } from './audio.js';
import {
  BUTTON_AGAIN,
  BUTTON_STOP,
  disconnectedMessage,
  focusEndedMessage,
  focusStartedMessage,
  promptTimedOutMessage,
} from './messages.js';
import type { MuteService } from './MuteService.js';
import { setVoiceChannelStatus } from './voiceStatus.js';
import { buildIntervalMarks, buildNicknameSchedule, pomodoroNickname } from './time.js';

export type Phase = 'focus' | 'awaiting' | 'ended';
export type StopReason = 'command' | 'button' | 'timeout' | 'disconnected' | 'shutdown';
/** Envia (ou edita) a mensagem de anúncio e devolve a mensagem que ficou no chat. */
export type Publish = (message: BaseMessageOptions) => Promise<Message>;

export interface SessionDeps {
  config: AppConfig;
  store: GuildStore;
  muter: MuteService;
  onEnded: (session: PomodoroSession) => void;
}

/** Um Pomodoro ativo em um servidor: conexão de voz, timers, mutes e apelido do bot. */
export class PomodoroSession {
  phase: Phase = 'focus';
  endsAt = 0;
  durationMs: number;
  private cycle = 0;
  private timers: NodeJS.Timeout[] = [];
  /** Mensagem com o botão ativo: "Encerrar" durante o foco, "Iniciar outro" depois dele. */
  private controlMessage?: Message;
  private readonly sounds: SoundPlayer;

  private constructor(
    private readonly deps: SessionDeps,
    readonly guild: Guild,
    readonly voiceChannel: VoiceBasedChannel,
    readonly textChannel: GuildTextBasedChannel,
    private readonly connection: VoiceConnection,
    private startedById: string,
  ) {
    this.durationMs = deps.config.pomodoroMs;
    this.sounds = new SoundPlayer(connection, deps.config.soundsEnabled);
    this.connection.on(VoiceConnectionStatus.Disconnected, () => void this.onDisconnected());
  }

  /** Entra na sala de voz e prepara a sessão (o foco começa com `startFocus`). */
  static async create(
    deps: SessionDeps,
    voiceChannel: VoiceBasedChannel,
    textChannel: GuildTextBasedChannel,
    startedById: string,
  ): Promise<PomodoroSession> {
    const { guild } = voiceChannel;
    const connection = joinVoiceChannel({
      guildId: guild.id,
      channelId: voiceChannel.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      connection.destroy();
      throw error;
    }

    // Guarda o apelido original (sem sobrescrever um backup deixado por uma queda anterior).
    if (!deps.store.get(guild.id).nicknameBackup) {
      await deps.store.update(guild.id, (g) => {
        g.nicknameBackup = { value: guild.members.me?.nickname ?? null };
      });
    }
    return new PomodoroSession(deps, guild, voiceChannel, textChannel, connection, startedById);
  }

  get voiceChannelId(): string {
    return this.voiceChannel.id;
  }

  get isFocusing(): boolean {
    return this.phase === 'focus';
  }

  /** O botão clicado é o que está ativo agora (e não um de uma mensagem antiga)? */
  isActiveButton(messageId: string, customId: string): boolean {
    const expected =
      this.phase === 'focus' ? BUTTON_STOP : this.phase === 'awaiting' ? BUTTON_AGAIN : undefined;
    return customId === expected && this.controlMessage?.id === messageId;
  }

  /** Quem pode controlar: quem iniciou, quem está na sala ou quem gerencia o servidor. */
  canControl(member: GuildMember): boolean {
    return (
      member.id === this.startedById ||
      member.voice.channelId === this.voiceChannelId ||
      member.permissions.has(PermissionFlagsBits.ManageGuild)
    );
  }

  isInRoom(member: GuildMember): boolean {
    return member.voice.channelId === this.voiceChannelId;
  }

  /**
   * Inicia um ciclo de foco e publica o anúncio (com o botão "Encerrar") via `publish`.
   * Sem `durationMs`, repete a duração do ciclo anterior (usado pelo botão "Iniciar outro").
   */
  async startFocus(
    startedById: string,
    publish: Publish,
    durationMs = this.durationMs,
  ): Promise<void> {
    this.clearTimers();
    this.controlMessage = undefined;
    this.startedById = startedById;
    this.durationMs = durationMs;
    this.phase = 'focus';
    this.cycle += 1;
    this.endsAt = Date.now() + durationMs;

    await this.muteEveryone();
    await this.setNickname(pomodoroNickname(durationMs));
    await this.setVoiceStatus(VOICE_STATUS_TEXT);
    this.sounds.play(SOUNDS.focus);

    for (const atMs of buildIntervalMarks(durationMs, FOCUS_SOUND_INTERVAL_MS)) {
      this.schedule(atMs, async () => this.sounds.play(SOUNDS.focus));
    }
    const steps = buildNicknameSchedule(
      durationMs,
      NICKNAME_UPDATE_INTERVAL_MS,
      NICKNAME_FINAL_WARNING_MS,
    );
    for (const step of steps) {
      this.schedule(step.atMs, () => this.setNickname(step.nickname));
    }
    this.schedule(durationMs, () => this.finishFocus());

    logger.info(
      `Pomodoro #${this.cycle} iniciado em ${this.guild.name} (${this.voiceChannel.name}).`,
    );
    const announcement = focusStartedMessage({
      client: this.guild.client,
      cycle: this.cycle,
      durationMs,
      endsAt: this.endsAt,
      voiceChannel: this.voiceChannel,
      startedById,
    });
    try {
      const message = await publish(announcement);
      // O foco pode ter sido parado enquanto a mensagem era enviada.
      if (this.phase === 'focus') this.controlMessage = message;
      else await message.edit({ components: [] }).catch(() => undefined);
    } catch (error) {
      logger.warn(`Não consegui enviar o anúncio do Pomodoro em ${this.guild.name}.`, error);
    }
  }

  /** Fim do foco: desmuta, restaura o apelido e pergunta se querem outro Pomodoro. */
  private async finishFocus(): Promise<void> {
    if (this.phase !== 'focus') return;
    this.phase = 'awaiting';
    this.clearTimers();
    await this.dismissControlMessage();

    await this.unmuteEveryone();
    await this.restoreNickname();
    await this.clearVoiceStatus();
    this.sounds.play(SOUNDS.end);

    const { responseTimeoutMs } = this.deps.config;
    try {
      this.controlMessage = await this.textChannel.send(
        focusEndedMessage(this.guild.client, this.voiceChannel, responseTimeoutMs),
      );
    } catch (error) {
      logger.warn(`Não consegui enviar a mensagem de fim em ${this.guild.name}.`, error);
    }
    this.schedule(responseTimeoutMs, () => this.onPromptTimeout());
    logger.info(`Pomodoro #${this.cycle} finalizado em ${this.guild.name}.`);
  }

  private async onPromptTimeout(): Promise<void> {
    if (this.phase !== 'awaiting') return;
    const prompt = this.takeControlMessage();
    await prompt
      ?.edit(promptTimedOutMessage(this.guild.client, this.voiceChannel))
      .catch(() => undefined);
    await this.stop('timeout');
  }

  /** Tira a mensagem com botão do controle da sessão (quem chamou vai editá-la). */
  takeControlMessage(): Message | undefined {
    const message = this.controlMessage;
    this.controlMessage = undefined;
    return message;
  }

  /** Remove o botão da mensagem atual, se houver. */
  async dismissControlMessage(): Promise<void> {
    await this.takeControlMessage()
      ?.edit({ components: [] })
      .catch(() => undefined);
  }

  /** Encerra tudo: desmuta, restaura o apelido e sai da sala. Idempotente. */
  async stop(reason: StopReason): Promise<void> {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimers();
    logger.info(`Encerrando Pomodoro em ${this.guild.name} (motivo: ${reason}).`);

    await this.dismissControlMessage();
    await this.unmuteEveryone();
    await this.restoreNickname();
    await this.clearVoiceStatus(); // antes de sair: o bot precisa estar conectado
    await this.deps.store.update(this.guild.id, (g) => {
      delete g.nicknameBackup;
    });

    this.sounds.stop();
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.deps.onEnded(this);

    if (reason === 'disconnected') {
      await this.textChannel.send(disconnectedMessage(this.guild.client)).catch(() => undefined);
    }
  }

  /** Chamado quando o estado de voz do próprio bot muda (movido, expulso da sala...). */
  async onOwnVoiceState(state: VoiceState): Promise<void> {
    if (this.phase !== 'ended' && state.channelId !== this.voiceChannelId) {
      await this.stop('disconnected');
    }
  }

  private async onDisconnected(): Promise<void> {
    // Padrão recomendado: se não começar a reconectar em 5s, a desconexão é real.
    try {
      await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      await this.stop('disconnected');
    }
  }

  private async muteEveryone(): Promise<void> {
    const botId = this.guild.members.me?.id;
    const states = this.guild.voiceStates.cache.filter(
      (s) => s.channelId === this.voiceChannelId && s.id !== botId,
    );
    await Promise.allSettled(
      states.map(async (state) => {
        if (!(await isBot(state))) await this.deps.muter.mute(state);
      }),
    );
  }

  private async unmuteEveryone(): Promise<void> {
    const ids = [...this.deps.store.get(this.guild.id).mutedByBot];
    await Promise.allSettled(
      ids.map(async (id) => {
        const state = this.guild.voiceStates.cache.get(id);
        // Quem não está em nenhuma chamada fica pendente e é desmutado ao voltar.
        if (state?.channelId) await this.deps.muter.release(state);
      }),
    );
  }

  private async setNickname(nickname: string | null): Promise<void> {
    try {
      await this.guild.members.me?.setNickname(nickname, 'Pomodoro BOT');
    } catch (error) {
      logger.warn(
        `Não consegui alterar meu apelido em ${this.guild.name}.`,
        (error as Error).message,
      );
    }
  }

  private async setVoiceStatus(status: string): Promise<void> {
    await this.deps.store.update(this.guild.id, (g) => {
      g.voiceStatusChannelId = this.voiceChannelId;
    });
    await setVoiceChannelStatus(this.guild.client, this.voiceChannelId, status);
  }

  /**
   * Limpa o status se ele ainda é o do bot. Se já foi limpo no fim do foco, não apaga um
   * status que alguém tenha definido enquanto o bot perguntava se querem outro Pomodoro.
   */
  private async clearVoiceStatus(): Promise<void> {
    if (this.deps.store.get(this.guild.id).voiceStatusChannelId !== this.voiceChannelId) return;
    await setVoiceChannelStatus(this.guild.client, this.voiceChannelId, '');
    await this.deps.store.update(this.guild.id, (g) => {
      delete g.voiceStatusChannelId;
    });
  }

  private async restoreNickname(): Promise<void> {
    await this.setNickname(this.deps.store.get(this.guild.id).nicknameBackup?.value ?? null);
  }

  private schedule(delayMs: number, task: () => Promise<void>): void {
    const timer = setTimeout(() => {
      task().catch((error) => logger.error('Erro em tarefa agendada do Pomodoro.', error));
    }, delayMs);
    this.timers.push(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}

export async function isBot(state: VoiceState): Promise<boolean> {
  if (state.member) return state.member.user.bot;
  try {
    return (await state.guild.members.fetch(state.id)).user.bot;
  } catch {
    return false;
  }
}
