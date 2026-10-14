import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { AppConfig } from './config.js';
import type { PomodoroManager } from './pomodoro/PomodoroManager.js';
import type { GuildStore } from './storage/GuildStore.js';

export interface BotContext {
  config: AppConfig;
  store: GuildStore;
  manager: PomodoroManager;
}

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction<'cached'>, ctx: BotContext): Promise<void>;
}
