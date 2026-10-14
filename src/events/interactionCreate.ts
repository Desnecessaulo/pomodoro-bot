import type { Interaction, InteractionReplyOptions } from 'discord.js';
import { commandsByName } from '../commands/index.js';
import { UserError } from '../errors.js';
import { logger } from '../logger.js';
import type { BotContext } from '../types.js';

export async function onInteractionCreate(
  interaction: Interaction,
  ctx: BotContext,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;

  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, ctx);
    } else if (interaction.isButton() && interaction.customId.startsWith('pomodoro:')) {
      await ctx.manager.handleButton(interaction);
    }
  } catch (error) {
    if (!(error instanceof UserError)) {
      logger.error(`Erro ao processar interação ${interaction.id}.`, error);
    }
    if (!interaction.isRepliable()) return;

    const content =
      error instanceof UserError ? `❌ ${error.message}` : '❌ Algo deu errado. Tente novamente.';
    const reply: InteractionReplyOptions = { content, flags: 'Ephemeral' };
    try {
      if (interaction.deferred) await interaction.editReply({ content, components: [] });
      else if (interaction.replied) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch (replyError) {
      logger.warn('Não consegui responder ao erro da interação.', replyError);
    }
  }
}
