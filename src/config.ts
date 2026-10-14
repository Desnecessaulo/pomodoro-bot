import { fileURLToPath } from 'node:url';

export const MINUTE_MS = 60_000;

/** Duração máxima que pode ser escolhida em /pomodoro iniciar. */
export const MAX_POMODORO_MINUTES = 59;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${name}. Veja o arquivo .env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function positiveNumber(name: string, fallback: number, max = Infinity): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(`${name} deve ser um número maior que 0 e até ${max} (recebido: "${raw}").`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = optional(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(raw);
}

/** Configuração lida de forma preguiçosa para que scripts possam importar sem um token válido. */
export function loadConfig() {
  return {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    devGuildId: optional('DEV_GUILD_ID'),
    pomodoroMs: positiveNumber('POMODORO_MINUTES', 25, MAX_POMODORO_MINUTES) * MINUTE_MS,
    responseTimeoutMs: positiveNumber('RESPONSE_TIMEOUT_MINUTES', 2) * MINUTE_MS,
    soundsEnabled: bool('SOUNDS_ENABLED', true),
  } as const;
}

export type AppConfig = ReturnType<typeof loadConfig>;

/** Intervalo entre as atualizações do apelido e o aviso extra antes do fim. */
export const NICKNAME_UPDATE_INTERVAL_MS = 10 * MINUTE_MS;
export const NICKNAME_FINAL_WARNING_MS = 5 * MINUTE_MS;

/** Status exibido na sala de voz durante o foco (sobrescreve qualquer status anterior). */
export const VOICE_STATUS_TEXT = 'POMODORO ROLANDO 🍅';

/** O som de foco (orb.mp3) toca no início e a cada este intervalo. */
export const FOCUS_SOUND_INTERVAL_MS = 10 * MINUTE_MS;

export const DATA_FILE = fileURLToPath(new URL('../data/store.json', import.meta.url));
export const AVATAR_FILE = fileURLToPath(new URL('../assets/icone.png', import.meta.url));
export const SOUNDS = {
  focus: fileURLToPath(new URL('../assets/sounds/orb.mp3', import.meta.url)),
  end: fileURLToPath(new URL('../assets/sounds/levelup.mp3', import.meta.url)),
} as const;
