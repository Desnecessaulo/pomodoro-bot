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

/** Duração legível para mensagens: "25 minutos", "1 minuto", "30 segundos". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE_MS) {
    const seconds = Math.round(ms / 1000);
    return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(ms / MINUTE_MS);
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

/**
 * Atualizações do apelido após o início: a cada `intervalMs` e também quando faltar
 * `finalWarningMs`. Para 25 min / 10 min / 5 min: 15m (aos 10 min) e 5m (aos 20 min).
 */
export function buildNicknameSchedule(
  durationMs: number,
  intervalMs: number,
  finalWarningMs: number,
): NicknameStep[] {
  const remainings = new Set<number>();
  for (let elapsed = intervalMs; elapsed < durationMs; elapsed += intervalMs) {
    remainings.add(durationMs - elapsed);
  }
  if (finalWarningMs < durationMs) remainings.add(finalWarningMs);

  return [...remainings]
    .sort((a, b) => b - a)
    .map((remaining) => ({ atMs: durationMs - remaining, nickname: pomodoroNickname(remaining) }));
}

/** Momentos (ms desde o início) a cada `intervalMs`, sem incluir o fim. Ex.: 25 min -> 10 e 20 min. */
export function buildIntervalMarks(durationMs: number, intervalMs: number): number[] {
  const marks: number[] = [];
  for (let elapsed = intervalMs; elapsed < durationMs; elapsed += intervalMs) marks.push(elapsed);
  return marks;
}

/** Timestamp do Discord, renderizado no fuso de cada usuário (ex.: "em 25 minutos"). */
export function discordRelativeTime(epochMs: number): string {
  return `<t:${Math.round(epochMs / 1000)}:R>`;
}
