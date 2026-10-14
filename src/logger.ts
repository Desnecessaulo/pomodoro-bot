type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.LOG_LEVEL?.toLowerCase() ?? 'info') as Level;
const threshold = LEVELS[envLevel] ?? LEVELS.info;

function log(level: Level, message: string, ...extra: unknown[]): void {
  if (LEVELS[level] < threshold) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${message}`;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(line, ...extra);
}

export const logger = {
  debug: (msg: string, ...extra: unknown[]) => log('debug', msg, ...extra),
  info: (msg: string, ...extra: unknown[]) => log('info', msg, ...extra),
  warn: (msg: string, ...extra: unknown[]) => log('warn', msg, ...extra),
  error: (msg: string, ...extra: unknown[]) => log('error', msg, ...extra),
};
