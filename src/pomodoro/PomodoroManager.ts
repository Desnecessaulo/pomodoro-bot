import {
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type VoiceState,
} from 'discord.js';
import type { AppConfig } from '../config.js';
import { UserError } from '../errors.js';
import { logger } from '../logger.js';
import type { GuildStore } from '../storage/GuildStore.js';
import { MuteService } from './MuteService.js';
import {
  BUTTON_AGAIN,
  BUTTON_STOP,
  isBot,
  PomodoroSession,
  type StopReason,
} from './PomodoroSession.js';
import { discordRelativeTime } from './time.js';
import { setVoiceChannelStatus } from './voiceStatus.js';

const REQUIRED_VOICE_PERMISSIONS = [
  [PermissionFlagsBits.ViewChannel, 'Ver canal'],
  [PermissionFlagsBits.Connect, 'Conectar'],
  [PermissionFlagsBits.MuteMembers, 'Silenciar membros'],
] as const;

/** Mantém uma sessão por servidor e reage às mudanças de voz. */
export class PomodoroManager {
  private readonly sessions = new Map<string, PomodoroSession>();
  private readonly starting = new Set<string>();
  private readonly muter: MuteService;

  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly store: GuildStore,
  ) {
    this.muter = new MuteService(store);
  }

  get(guildId: string): PomodoroSession | undefined {
    return this.sessions.get(guildId);
  }

  /**
   * /pomodoro iniciar — entra na sala configurada e começa o foco com a duração escolhida.
   * `onValidated` é chamado quando todas as checagens passam, antes da parte demorada.
   */
  async start(
    interaction: ChatInputCommandInteraction<'cached'>,
    durationMs: number,
    onValidated: () => Promise<unknown>,
  ): Promise<string> {
    const { guild, guildId, member, channel: textChannel } = interaction;

    const existing = this.sessions.get(guildId);
    if (existing?.phase === 'focus') {
      throw new UserError(
        `Já existe um Pomodoro em andamento em ${existing.voiceChannel} ` +
          `(termina ${discordRelativeTime(existing.endsAt)}). ` +
          'Não é possível iniciar outro até ele acabar ou ser parado com `/pomodoro parar`.',
      );
    }
    if (this.starting.has(guildId)) {
      throw new UserError('Já existe um Pomodoro sendo iniciado agora. Aguarde.');
    }

    // Pomodoro recém-terminado aguardando resposta: começa outro na mesma sala.
    if (existing?.phase === 'awaiting') {
      this.assertInRoom(member.voice.channelId, existing.voiceChannelId);
      this.starting.add(guildId);
      try {
        await onValidated();
        await existing.dismissPrompt();
        return await existing.startFocus(interaction.user.id, durationMs);
      } finally {
        this.starting.delete(guildId);
      }
    }

    const voiceChannelId = this.store.get(guildId).voiceChannelId;
    if (!voiceChannelId) {
      throw new UserError('Nenhuma sala de voz configurada. Use `/config sala` primeiro.');
    }
    const voiceChannel = guild.channels.cache.get(voiceChannelId);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      throw new UserError('A sala configurada não existe mais. Use `/config sala` novamente.');
    }
    this.assertInRoom(member.voice.channelId, voiceChannel.id);

    const me = guild.members.me;
    if (!textChannel || !me)
      throw new UserError('Use este comando em um canal de texto do servidor.');

    const voicePermissions = voiceChannel.permissionsFor(me);
    const missing = REQUIRED_VOICE_PERMISSIONS.filter(([flag]) => !voicePermissions.has(flag)).map(
      ([, name]) => name,
    );
    if (missing.length > 0) {
      throw new UserError(
        `Preciso das permissões **${missing.join(', ')}** em ${voiceChannel} para funcionar.`,
      );
    }
    if (!voiceChannel.joinable) {
      throw new UserError(`Não consigo entrar em ${voiceChannel} (a sala pode estar cheia).`);
    }
    if (!textChannel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
      throw new UserError('Não tenho permissão para enviar mensagens neste canal.');
    }

    this.starting.add(guildId);
    try {
      await onValidated();
      const session = await PomodoroSession.create(
        {
          config: this.config,
          store: this.store,
          muter: this.muter,
          onEnded: (s) => {
            if (this.sessions.get(guildId) === s) this.sessions.delete(guildId);
          },
        },
        voiceChannel,
        textChannel,
        interaction.user.id,
      );
      this.sessions.set(guildId, session);
      return await session.startFocus(interaction.user.id, durationMs);
    } catch (error) {
      logger.error(`Falha ao iniciar Pomodoro em ${guild.name}.`, error);
      throw new UserError(`Não consegui entrar em ${voiceChannel}. Tente novamente em instantes.`);
    } finally {
      this.starting.delete(guildId);
    }
  }

  /** Só quem está na sala do Pomodoro pode iniciá-lo. */
  private assertInRoom(memberChannelId: string | null, roomId: string): void {
    if (memberChannelId !== roomId) {
      throw new UserError(
        `Você não está na sala certa! Entre em <#${roomId}> para iniciar o Pomodoro.`,
      );
    }
  }

  async stop(guildId: string, reason: StopReason): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;
    await session.stop(reason);
    return true;
  }

  /** Botões "Começar outro" / "Encerrar" da mensagem de fim do Pomodoro. */
  async handleButton(interaction: ButtonInteraction<'cached'>): Promise<void> {
    const session = this.sessions.get(interaction.guildId);
    if (!session?.isPrompt(interaction.message.id)) {
      await interaction.reply({
        content: 'Este convite já expirou. Use `/pomodoro iniciar` para começar um novo.',
        flags: 'Ephemeral',
      });
      return;
    }
    const isAgain = interaction.customId === BUTTON_AGAIN;
    const allowed = isAgain
      ? session.isInRoom(interaction.member)
      : session.canControl(interaction.member);
    if (!allowed) {
      await interaction.reply({
        content: isAgain
          ? `Você não está na sala certa! Entre em ${session.voiceChannel} para começar outro Pomodoro.`
          : `Só quem está em ${session.voiceChannel} pode encerrar.`,
        flags: 'Ephemeral',
      });
      return;
    }

    await interaction.deferUpdate();
    session.takePrompt();
    if (interaction.customId === BUTTON_AGAIN) {
      const announcement = await session.startFocus(interaction.user.id);
      await interaction.editReply({
        content: `${announcement}\n-# Iniciado por ${interaction.user}`,
        components: [],
      });
    } else if (interaction.customId === BUTTON_STOP) {
      await session.stop('button');
      await interaction.editReply({
        content: `👋 Pomodoro encerrado por ${interaction.user}. Saí da sala — bom descanso!`,
        components: [],
      });
    }
  }

  /** Muta quem entra na sala durante o foco e desmuta quem o bot mutou ao sair dela. */
  async handleVoiceStateUpdate(_oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guildId = newState.guild.id;
    const session = this.sessions.get(guildId);

    if (newState.id === this.client.user?.id) {
      await session?.onOwnVoiceState(newState);
      return;
    }

    if (session?.isFocusing && newState.channelId === session.voiceChannelId) {
      // Entrou na sala (ou foi desmutado manualmente) durante o foco: muta.
      if (!newState.serverMute && !(await isBot(newState))) await this.muter.mute(newState);
      return;
    }

    // Saiu da sala ou o foco acabou: desmuta quem ainda está pendente.
    if (newState.channelId && this.store.isMutedByBot(guildId, newState.id)) {
      await this.muter.release(newState);
    }
  }

  /** Ao iniciar: desfaz mutes e apelido deixados por uma queda/reinício anterior. */
  async recover(): Promise<void> {
    for (const guildId of this.store.guildIds()) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      const data = this.store.get(guildId);

      for (const userId of [...data.mutedByBot]) {
        const state = guild.voiceStates.cache.get(userId);
        if (state?.channelId) await this.muter.release(state);
      }
      if (data.nicknameBackup) {
        await guild.members.me
          ?.setNickname(data.nicknameBackup.value, 'Pomodoro BOT reiniciado')
          .catch((error) =>
            logger.warn(`Não consegui restaurar o apelido em ${guild.name}.`, error),
          );
        await this.store.update(guildId, (g) => {
          delete g.nicknameBackup;
        });
      }
      if (data.voiceStatusChannelId) {
        // Fora da sala, limpar o status exige "Gerenciar canais"; se falhar, só registra no log.
        await setVoiceChannelStatus(this.client, data.voiceStatusChannelId, '');
        await this.store.update(guildId, (g) => {
          delete g.voiceStatusChannelId;
        });
      }
      if (data.mutedByBot.length > 0) {
        logger.info(`${data.mutedByBot.length} membro(s) pendente(s) de desmute em ${guild.name}.`);
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((s) => s.stop('shutdown')));
  }
}
