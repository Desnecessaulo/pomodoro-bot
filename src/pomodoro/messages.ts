import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
  type Client,
  type VoiceBasedChannel,
} from 'discord.js';
import { formatClock, formatDuration, formatRemainingText } from './time.js';

export const BUTTON_AGAIN = 'pomodoro:again';
export const BUTTON_STOP = 'pomodoro:stop';
export const BUTTON_BREAK = 'pomodoro:break';

/** Como um anúncio de foco/pausa fica quando sai de cena (sem botões). */
export type Ending = 'done' | 'stopped';

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

function buttonRow(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

function stopButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(BUTTON_STOP)
    .setLabel('Encerrar')
    .setEmoji('⏹️')
    .setStyle(ButtonStyle.Danger);
}

/** "24 minutos restantes" enquanto corre; "Finalizado"/"Encerrado" quando sai de cena. */
function durationLine(remainingMs: number, ending?: Ending, female = false) {
  const suffix = female ? 'a' : 'o';
  if (ending === 'done') return `Finalizad${suffix}`;
  if (ending === 'stopped') return `Encerrad${suffix}`;
  return formatRemainingText(remainingMs);
}

export function focusMessage(options: {
  client: Client;
  cycle: number;
  remainingMs: number;
  endsAt: number;
  voiceChannel: VoiceBasedChannel;
  startedById: string;
  /** Duração da pausa oferecida pelo botão "Pausa e +1 Pomodoro" (ausente: sem botão). */
  breakMs?: number;
  /** Quem pediu a pausa e +1 Pomodoro, se já foi pedida. */
  breakRequestedById?: string;
  ending?: Ending;
}): BaseMessageOptions {
  const { client, cycle, remainingMs, endsAt, voiceChannel, startedById } = options;
  const { breakMs, breakRequestedById, ending } = options;
  const title = cycle > 1 ? `Pomodoro #${cycle} iniciado!` : 'Pomodoro iniciado!';
  const lines = [
    `**Duração:** ${durationLine(remainingMs, ending)}`,
    `**Sala:** ${voiceChannel}`,
    `**Termina:** ${formatClock(endsAt)}`,
    `**Iniciado por:** <@${startedById}>`,
  ];
  if (!ending) {
    lines.push('', '🔇 Microfones mutados — foco total!');
    if (breakMs && breakRequestedById) {
      lines.push(
        `☕ Pausa de ${formatDuration(breakMs)} e +1 Pomodoro agendados por <@${breakRequestedById}>.`,
      );
    }
  }
  const embed = pomodoroEmbed(client, `🍅 ${title}`, COLORS.focus, lines);

  if (ending) return { content: '', embeds: [embed], components: [] };
  const buttons = [stopButton()];
  if (breakMs && !breakRequestedById) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(BUTTON_BREAK)
        .setLabel('Pausa e +1 Pomodoro')
        .setEmoji('☕')
        .setStyle(ButtonStyle.Primary),
    );
  }
  return { content: '', embeds: [embed], components: [buttonRow(...buttons)] };
}

export function breakMessage(options: {
  client: Client;
  remainingMs: number;
  endsAt: number;
  nextCycle: number;
  focusMs: number;
  voiceChannel: VoiceBasedChannel;
  requestedById: string;
  ending?: Ending;
}): BaseMessageOptions {
  const { client, remainingMs, endsAt, nextCycle, focusMs, voiceChannel, ending } = options;
  const lines = [
    `**Duração:** ${durationLine(remainingMs, ending, true)}`,
    `**Sala:** ${voiceChannel}`,
    `**Termina:** ${formatClock(endsAt)}`,
    `**Pedida por:** <@${options.requestedById}>`,
    '',
  ];
  if (ending === 'done') lines.push(`🍅 Pomodoro #${nextCycle} começando!`);
  else if (ending === 'stopped') lines.push('⏹️ Pausa encerrada.');
  else {
    lines.push(
      '🔊 Microfones liberados — aproveite a pausa!',
      `🍅 Em seguida começa o Pomodoro #${nextCycle} (${formatDuration(focusMs)}) automaticamente.`,
    );
  }
  const embed = pomodoroEmbed(client, '☕ Pausa!', ending ? COLORS.ended : COLORS.break, lines);
  return { content: '', embeds: [embed], components: ending ? [] : [buttonRow(stopButton())] };
}

function focusEndedLines(voiceChannel: VoiceBasedChannel): string[] {
  return [`**Sala:** ${voiceChannel}`, '🔊 Microfones liberados. Bom descanso!'];
}

export function focusEndedMessage(
  client: Client,
  voiceChannel: VoiceBasedChannel,
): BaseMessageOptions {
  const embed = pomodoroEmbed(client, '⏰ O Pomodoro acabou!', COLORS.break, [
    ...focusEndedLines(voiceChannel),
    '',
    'Querem começar outro?',
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
    | { phase: 'break'; voiceChannel: VoiceBasedChannel; endsAt: number }
    | { phase: 'awaiting'; voiceChannel: VoiceBasedChannel }
    | { phase: 'idle'; configuredChannelId?: string },
): BaseMessageOptions {
  let embed: EmbedBuilder;
  if (state.phase === 'focus' || state.phase === 'break') {
    const isFocus = state.phase === 'focus';
    embed = pomodoroEmbed(
      client,
      isFocus ? '🍅 Foco em andamento' : '☕ Pausa em andamento',
      isFocus ? COLORS.focus : COLORS.break,
      [
        `**Duração:** ${formatRemainingText(Math.max(0, state.endsAt - Date.now()))}`,
        `**Sala:** ${state.voiceChannel}`,
        `**Termina:** ${formatClock(state.endsAt)}`,
      ],
    );
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
