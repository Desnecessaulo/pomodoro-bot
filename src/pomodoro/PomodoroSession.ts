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
  BREAK_ENDING_WARNING_MS,
  BREAK_VOICE_STATUS_TEXT,
  FOCUS_SOUND_FINAL_WARNING_MS,
  FOCUS_SOUND_INTERVAL_MS,
  MINUTE_MS,
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
  BUTTON_BREAK,
  BUTTON_STOP,
  breakMessage,
  disconnectedMessage,
  focusEndedMessage,
  focusMessage,
  promptTimedOutMessage,
  type Ending,
} from './messages.js';
import type { MuteService } from './MuteService.js';
import { setVoiceChannelStatus } from './voiceStatus.js';
import {
  breakDurationFor,
  breakNickname,
  buildFocusSoundMarks,
  buildIntervalMarks,
  buildNicknameSchedule,
  pomodoroNickname,
} from './time.js';

export type Phase = 'focus' | 'break' | 'awaiting' | 'ended';
export type StopReason = 'command' | 'button' | 'timeout' | 'disconnected' | 'shutdown';
/** Envia (ou edita) a mensagem de anúncio e devolve a mensagem que ficou no chat. */
export type Publish = (message: BaseMessageOptions) => Promise<Message>;
/** Desenha a mensagem de controle no estado atual (ou como ela fica ao sair de cena). */
type ControlView = (ending?: Ending) => BaseMessageOptions;

export interface SessionDeps {
  config: AppConfig;
  store: GuildStore;
  muter: MuteService;
  onEnded: (session: PomodoroSession) => void;
}

/** Um Pomodoro ativo em um servidor: conexão de voz, timers, mutes e apelido do bot. */
export class PomodoroSession {
  phase: Phase = 'focus';
  /** Fim da fase atual (foco ou pausa). */
  endsAt = 0;
  durationMs: number;
  private cycle = 0;
  /** Tempo restante mostrado na mensagem; atualizado a cada minuto. */
  private remainingMs = 0;
  /** Quem clicou em "Pausa e +1 Pomodoro" durante o foco atual. */
  private breakRequestedById?: string;
  private timers: NodeJS.Timeout[] = [];
  /**
   * Mensagem com os botões ativos: "Encerrar" (e "Pausa e +1 Pomodoro") durante o foco,
   * "Encerrar" durante a pausa e "Iniciar outro" depois do foco.
   */
  private controlMessage?: Message;
  private controlView?: ControlView;
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

  /** Duração da pausa oferecida após o foco atual (ausente se o foco for curto demais). */
  private get breakMs(): number | undefined {
    return breakDurationFor(this.durationMs);
  }

  /** O botão clicado é o que está ativo agora (e não um de uma mensagem antiga)? */
  isActiveButton(messageId: string, customId: string): boolean {
    if (this.controlMessage?.id !== messageId) return false;
    switch (customId) {
      case BUTTON_STOP:
        return this.phase === 'focus' || this.phase === 'break';
      case BUTTON_BREAK:
        return this.phase === 'focus' && !!this.breakMs && !this.breakRequestedById;
      case BUTTON_AGAIN:
        return this.phase === 'awaiting';
      default:
        return false;
    }
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
   * Inicia um ciclo de foco e publica o anúncio (com os botões) via `publish`.
   * Sem `durationMs`, repete a duração do ciclo anterior (botão "Iniciar outro" e +1 Pomodoro).
   */
  async startFocus(
    startedById: string,
    publish: Publish,
    durationMs = this.durationMs,
  ): Promise<void> {
    this.clearTimers();
    this.controlMessage = undefined;
    this.startedById = startedById;
    this.breakRequestedById = undefined;
    this.durationMs = durationMs;
    this.phase = 'focus';
    this.cycle += 1;
    this.endsAt = Date.now() + durationMs;
    this.remainingMs = durationMs;

    await this.muteEveryone();
    await this.setNickname(pomodoroNickname(durationMs));
    await this.setVoiceStatus(VOICE_STATUS_TEXT);
    this.sounds.play(SOUNDS.focus);

    const soundMarks = buildFocusSoundMarks(
      durationMs,
      FOCUS_SOUND_INTERVAL_MS,
      FOCUS_SOUND_FINAL_WARNING_MS,
    );
    for (const atMs of soundMarks) {
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
    this.scheduleCountdown(durationMs);
    this.schedule(durationMs, () => this.finishFocus());

    logger.info(
      `Pomodoro #${this.cycle} iniciado em ${this.guild.name} (${this.voiceChannel.name}).`,
    );
    const cycle = this.cycle;
    const endsAt = this.endsAt;
    this.controlView = (ending) =>
      focusMessage({
        client: this.guild.client,
        cycle,
        remainingMs: this.remainingMs,
        endsAt,
        voiceChannel: this.voiceChannel,
        startedById,
        breakMs: this.breakMs,
        breakRequestedById: this.breakRequestedById,
        ending,
      });
    try {
      const message = await publish(this.controlView());
      // O foco pode ter sido parado enquanto a mensagem era enviada.
      if (this.phase === 'focus' && this.cycle === cycle) this.controlMessage = message;
      else await message.edit({ components: [] }).catch(() => undefined);
    } catch (error) {
      logger.warn(`Não consegui enviar o anúncio do Pomodoro em ${this.guild.name}.`, error);
    }
  }

  /** Botão "Pausa e +1 Pomodoro": agenda a pausa e o próximo foco para o fim deste. */
  async requestBreak(requestedById: string): Promise<void> {
    if (this.phase !== 'focus' || !this.breakMs || this.breakRequestedById) return;
    this.breakRequestedById = requestedById;
    logger.info(`Pausa e +1 Pomodoro agendados em ${this.guild.name}.`);
    await this.refreshControlMessage();
  }

  /** Fim do foco: segue para a pausa (se pedida) ou desmuta e pergunta se querem outro. */
  private async finishFocus(): Promise<void> {
    if (this.phase !== 'focus') return;
    this.clearTimers();
    logger.info(`Pomodoro #${this.cycle} finalizado em ${this.guild.name}.`);
    const breakMs = this.breakMs;
    if (breakMs && this.breakRequestedById) {
      return this.startBreak(breakMs, this.breakRequestedById);
    }

    this.phase = 'awaiting';
    await this.closeControlMessage('done');
    await this.unmuteEveryone();
    await this.restoreNickname();
    await this.clearVoiceStatus();
    this.sounds.play(SOUNDS.end);

    this.controlView = undefined;
    try {
      this.controlMessage = await this.textChannel.send(
        focusEndedMessage(this.guild.client, this.voiceChannel),
      );
    } catch (error) {
      logger.warn(`Não consegui enviar a mensagem de fim em ${this.guild.name}.`, error);
    }
    this.schedule(this.deps.config.responseTimeoutMs, () => this.onPromptTimeout());
  }

  /** Pausa entre dois focos: desmuta todos e, ao acabar, começa o próximo Pomodoro sozinho. */
  private async startBreak(breakMs: number, requestedById: string): Promise<void> {
    this.phase = 'break';
    this.endsAt = Date.now() + breakMs;
    this.remainingMs = breakMs;
    this.sounds.play(SOUNDS.end, SOUNDS.breakStart);

    await this.unmuteEveryone();
    await this.setNickname(breakNickname(breakMs));
    await this.setVoiceStatus(BREAK_VOICE_STATUS_TEXT);

    for (const step of buildNicknameSchedule(
      breakMs,
      NICKNAME_UPDATE_INTERVAL_MS,
      NICKNAME_FINAL_WARNING_MS,
      breakNickname,
    )) {
      this.schedule(step.atMs, () => this.setNickname(step.nickname));
    }
    if (breakMs > BREAK_ENDING_WARNING_MS) {
      this.schedule(breakMs - BREAK_ENDING_WARNING_MS, async () =>
        this.sounds.play(SOUNDS.breakEnding),
      );
    }
    this.scheduleCountdown(breakMs);
    this.schedule(breakMs, () => this.finishBreak(requestedById));
    logger.info(`Pausa iniciada em ${this.guild.name}.`);

    const endsAt = this.endsAt;
    const nextCycle = this.cycle + 1;
    const focusMs = this.durationMs;
    this.controlView = (ending) =>
      breakMessage({
        client: this.guild.client,
        remainingMs: this.remainingMs,
        endsAt,
        nextCycle,
        focusMs,
        voiceChannel: this.voiceChannel,
        requestedById,
        ending,
      });
    // "O texto muda": o anúncio do foco vira o da pausa (ou um novo, se não houver).
    if (this.controlMessage) {
      await this.refreshControlMessage();
      return;
    }
    try {
      const message = await this.textChannel.send(this.controlView());
      if (this.phase === 'break') this.controlMessage = message;
      else await message.edit({ components: [] }).catch(() => undefined);
    } catch (error) {
      logger.warn(`Não consegui enviar o anúncio da pausa em ${this.guild.name}.`, error);
    }
  }

  private async finishBreak(startedById: string): Promise<void> {
    if (this.phase !== 'break') return;
    this.clearTimers();
    await this.closeControlMessage('done');
    await this.startFocus(startedById, (message) => this.textChannel.send(message));
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

  /** Tira os botões da mensagem atual e a deixa com o estado final (concluído/encerrado). */
  private async closeControlMessage(ending: Ending): Promise<void> {
    const view = this.controlView;
    const message = this.takeControlMessage();
    await message?.edit(view ? view(ending) : { components: [] }).catch(() => undefined);
  }

  /** Redesenha a mensagem de controle (contagem regressiva, pausa agendada...). */
  private async refreshControlMessage(): Promise<void> {
    if (!this.controlMessage || !this.controlView) return;
    await this.controlMessage
      .edit(this.controlView())
      .catch((error) =>
        logger.warn(`Não consegui atualizar a mensagem em ${this.guild.name}.`, error.message),
      );
  }

  /** Atualiza o "X minutos restantes" da mensagem a cada minuto. */
  private scheduleCountdown(durationMs: number): void {
    for (const atMs of buildIntervalMarks(durationMs, MINUTE_MS)) {
      this.schedule(atMs, async () => {
        this.remainingMs = durationMs - atMs;
        await this.refreshControlMessage();
      });
    }
  }

  /** Encerra tudo: desmuta, restaura o apelido e sai da sala. Idempotente. */
  async stop(reason: StopReason): Promise<void> {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.clearTimers();
    logger.info(`Encerrando Pomodoro em ${this.guild.name} (motivo: ${reason}).`);

    await this.closeControlMessage('stopped');
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
