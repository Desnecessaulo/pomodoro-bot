import type { Command } from '../types.js';
import { configCommand } from './config.js';
import { pomodoroCommand } from './pomodoro.js';

export const commands: readonly Command[] = [configCommand, pomodoroCommand];

export const commandsByName = new Map(commands.map((command) => [command.data.name, command]));
