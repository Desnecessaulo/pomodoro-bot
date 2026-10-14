import { REST, Routes } from 'discord.js';
import { commands } from '../commands/index.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';

/** Registra os slash commands. Rode novamente sempre que alterar a definição de um comando. */
const { token, clientId, devGuildId } = loadConfig();
const rest = new REST().setToken(token);
const body = commands.map((command) => command.data.toJSON());

const route = devGuildId
  ? Routes.applicationGuildCommands(clientId, devGuildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body });
logger.info(
  `${body.length} comando(s) registrado(s) ${devGuildId ? `no servidor ${devGuildId}` : 'globalmente'}.`,
);
