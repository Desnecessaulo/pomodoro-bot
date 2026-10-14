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
import { BUTTON_AGAIN, stoppedMessage } from './messages.js';
import { MuteService } from './MuteService.js';
import { isBot, PomodoroSession, type Publish, type StopReason } from './PomodoroSession.js';
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
   * O anúncio é publicado como resposta ao comando.
   */
  async start(
    interaction: ChatInputCommandInteraction<'cached'>,
    durationMs: number,
    onValidated: () => Promise<unknown>,
  ): Promise<void> {
    const { guild, guildId, member, channel: textChannel } = interaction;
    const publish: Publish = (message) => interaction.editReply(message);

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
        await existing.dismissControlMessage();
        return await existing.startFocus(interaction.user.id, publish, durationMs);
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
      return await session.startFocus(interaction.user.id, publish, durationMs);
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

  /** Botões "Encerrar" (durante o foco) e "Iniciar outro" (depois do foco). */
  async handleButton(interaction: ButtonInteraction<'cached'>): Promise<void> {
    const session = this.sessions.get(interaction.guildId);
    if (!session?.isActiveButton(interaction.message.id, interaction.customId)) {
      await interaction.reply({
        content: 'Este botão já expirou. Use `/pomodoro iniciar` para começar um novo.',
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

    // A mensagem do botão passa a ser editada aqui (e não pela sessão); tirar antes do
    // primeiro await evita que dois cliques simultâneos sejam processados.
    session.takeControlMessage();
    await interaction.deferUpdate();
    if (isAgain) {
      await session.startFocus(interaction.user.id, (message) => interaction.editReply(message));
    } else {
      await session.stop('button');
      await interaction.editReply(stoppedMessage(this.client, interaction.user.id));
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
