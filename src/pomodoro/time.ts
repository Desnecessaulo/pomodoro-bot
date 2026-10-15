const MINUTE_MS = 60_000;

export interface NicknameStep {
  /** Tempo decorrido (ms desde o início) em que o apelido deve mudar. */
  atMs: number;
  nickname: string;
}

/** Ex.: 25 min -> "25m"; arredonda para cima para nunca mostrar 0m antes do fim. */
export function formatRemaining(remainingMs: number): string {
  return `${Math.max(1, Math.ceil(remainingMs / MINUTE_MS))}m`;
}

export function pomodoroNickname(remainingMs: number): string {
  return `Pomodoro: ${formatRemaining(remainingMs)}`;
}

export function breakNickname(remainingMs: number): string {
  return `Pomodoro PAUSA: ${formatRemaining(remainingMs)}`;
}

/** Duração legível para mensagens: "25 minutos", "1 minuto", "30 segundos". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) {
    const seconds = Math.round(ms / 1000);
    return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(ms / MINUTE_MS);
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

/** Tempo restante para mensagens: "24 minutos restantes", "1 minuto restante". */
export function formatRemainingText(ms: number): string {
  const [value, unit] =
    ms < MINUTE_MS
      ? [Math.max(1, Math.ceil(ms / 1000)), 'segundo']
      : [Math.ceil(ms / MINUTE_MS), 'minuto'];
  const plural = value === 1 ? '' : 's';
  return `${value} ${unit}${plural} restante${plural}`;
}

const brasiliaClock = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
});

/** Horário de Brasília no formato "09:35". */
export function formatClock(epochMs: number): string {
  return brasiliaClock.format(epochMs);
}

/**
 * Atualizações do apelido após o início: a cada `intervalMs` e também quando faltar
 * `finalWarningMs`. Para 25 min / 5 min / 5 min: 20m, 15m, 10m e 5m.
 */
export function buildNicknameSchedule(
  durationMs: number,
  intervalMs: number,
  finalWarningMs: number,
  nickname: (remainingMs: number) => string = pomodoroNickname,
): NicknameStep[] {
  const remainings = new Set<number>();
  for (let elapsed = intervalMs; elapsed < durationMs; elapsed += intervalMs) {
    remainings.add(durationMs - elapsed);
  }
  if (finalWarningMs < durationMs) remainings.add(finalWarningMs);

  return [...remainings]
    .sort((a, b) => b - a)
    .map((remaining) => ({ atMs: durationMs - remaining, nickname: nickname(remaining) }));
}

/** Momentos (ms desde o início) a cada `intervalMs`, sem incluir o fim. Ex.: 25 min -> 10 e 20 min. */
export function buildIntervalMarks(durationMs: number, intervalMs: number): number[] {
  const marks: number[] = [];
  for (let elapsed = intervalMs; elapsed < durationMs; elapsed += intervalMs) marks.push(elapsed);
  return marks;
}

/**
 * Momentos do som de foco: a cada `intervalMs` e também quando faltar `finalWarningMs`.
 * Ex.: 30 min / 10 min / 5 min -> 10, 20 e 25 min.
 */
export function buildFocusSoundMarks(
  durationMs: number,
  intervalMs: number,
  finalWarningMs: number,
): number[] {
  const marks = new Set(buildIntervalMarks(durationMs, intervalMs));
  if (finalWarningMs < durationMs) marks.add(durationMs - finalWarningMs);
  return [...marks].sort((a, b) => a - b);
}

/**
 * Pausa do botão "Pausa e +1 Pomodoro": 5 min para focos de 25 a 49 min e 10 min a partir
 * de 50 min. Abaixo de 25 min não há pausa (`undefined`).
 */
export function breakDurationFor(focusMs: number): number | undefined {
  if (focusMs < 25 * MINUTE_MS) return undefined;
  return focusMs < 50 * MINUTE_MS ? 5 * MINUTE_MS : 10 * MINUTE_MS;
}
