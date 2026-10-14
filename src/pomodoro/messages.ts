import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
  type Client,
  type VoiceBasedChannel,
} from 'discord.js';
import { discordRelativeTime, formatDuration } from './time.js';

export const BUTTON_AGAIN = 'pomodoro:again';
export const BUTTON_STOP = 'pomodoro:stop';

const COLORS = {
  focus: 0xe74c3c,
  break: 0x2ecc71,
  ended: 0x99aab5,
  warning: 0xf1c40f,
} as const;

/** Embed no estilo "cartão": avatar do bot + título na linha do autor e o texto abaixo. */
export function pomodoroEmbed(
  client: Client,
  title: string,
  color: number,
  lines: string[],
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: title, iconURL: client.user?.displayAvatarURL() })
    .setDescription(lines.join('\n'));
}

function buttonRow(button: ButtonBuilder): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

export function focusStartedMessage(options: {
  client: Client;
  cycle: number;
  durationMs: number;
  endsAt: number;
  voiceChannel: VoiceBasedChannel;
  startedById: string;
}): BaseMessageOptions {
  const { client, cycle, durationMs, endsAt, voiceChannel, startedById } = options;
  const title = cycle > 1 ? `Pomodoro #${cycle} iniciado!` : 'Pomodoro iniciado!';
  const embed = pomodoroEmbed(client, `🍅 ${title}`, COLORS.focus, [
    `**Duração:** ${formatDuration(durationMs)}`,
    `**Sala:** ${voiceChannel}`,
    `**Termina:** ${discordRelativeTime(endsAt)}`,
    `**Iniciado por:** <@${startedById}>`,
    '',
    '🔇 Microfones mutados — foco total!',
  ]);
  const stop = new ButtonBuilder()
    .setCustomId(BUTTON_STOP)
    .setLabel('Encerrar')
    .setEmoji('⏹️')
    .setStyle(ButtonStyle.Danger);
  return { content: '', embeds: [embed], components: [buttonRow(stop)] };
}

function focusEndedLines(voiceChannel: VoiceBasedChannel): string[] {
  return [`**Sala:** ${voiceChannel}`, '🔊 Microfones liberados. Bom descanso!'];
}

export function focusEndedMessage(
  client: Client,
  voiceChannel: VoiceBasedChannel,
  responseTimeoutMs: number,
): BaseMessageOptions {
  const embed = pomodoroEmbed(client, '⏰ O Pomodoro acabou!', COLORS.break, [
    ...focusEndedLines(voiceChannel),
    '',
    `Querem começar outro? Se ninguém responder em ${formatDuration(responseTimeoutMs)}, eu saio da sala.`,
  ]);
  const again = new ButtonBuilder()
    .setCustomId(BUTTON_AGAIN)
    .setLabel('Iniciar outro')
    .setEmoji('🍅')
    .setStyle(ButtonStyle.Success);
  return { embeds: [embed], components: [buttonRow(again)] };
}

export function promptTimedOutMessage(
  client: Client,
  voiceChannel: VoiceBasedChannel,
): BaseMessageOptions {
  const embed = pomodoroEmbed(client, '⏰ O Pomodoro acabou!', COLORS.ended, [
    ...focusEndedLines(voiceChannel),
    '',
    '👋 Ninguém respondeu, então saí da sala. Até a próxima!',
  ]);
  return { embeds: [embed], components: [] };
}

export function stoppedMessage(client: Client, stoppedById: string): BaseMessageOptions {
  const embed = pomodoroEmbed(client, '⏹️ Pomodoro encerrado', COLORS.ended, [
    `**Encerrado por:** <@${stoppedById}>`,
    '🔊 Microfones liberados.',
  ]);
  return { content: '', embeds: [embed], components: [] };
}

export function disconnectedMessage(client: Client): BaseMessageOptions {
  const embed = pomodoroEmbed(client, '⚠️ Desconectado da sala', COLORS.warning, [
    'Fui desconectado da sala de voz. Pomodoro encerrado e microfones liberados.',
  ]);
  return { embeds: [embed] };
}

export function statusMessage(
  client: Client,
  state:
    | { phase: 'focus'; voiceChannel: VoiceBasedChannel; endsAt: number }
    | { phase: 'awaiting'; voiceChannel: VoiceBasedChannel }
    | { phase: 'idle'; configuredChannelId?: string },
): BaseMessageOptions {
  let embed: EmbedBuilder;
  if (state.phase === 'focus') {
    embed = pomodoroEmbed(client, '🍅 Foco em andamento', COLORS.focus, [
      `**Sala:** ${state.voiceChannel}`,
      `**Termina:** ${discordRelativeTime(state.endsAt)}`,
    ]);
  } else if (state.phase === 'awaiting') {
    embed = pomodoroEmbed(client, '⏰ O Pomodoro acabou', COLORS.break, [
      `**Sala:** ${state.voiceChannel}`,
      'Aguardando para começar outro.',
    ]);
  } else {
    embed = pomodoroEmbed(client, '💤 Nenhum Pomodoro ativo', COLORS.ended, [
      state.configuredChannelId
        ? `**Sala configurada:** <#${state.configuredChannelId}>`
        : 'Nenhuma sala configurada (use `/config sala`).',
    ]);
  }
  return { embeds: [embed] };
}
