import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { MAX_POMODORO_MINUTES, MINUTE_MS } from '../config.js';
import { UserError } from '../errors.js';
import { discordRelativeTime } from '../pomodoro/time.js';
import type { Command } from '../types.js';

export const pomodoroCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('pomodoro')
    .setDescription('Controla o Pomodoro na sala de voz configurada')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('iniciar')
        .setDescription('Entra na sala e muta todos durante o Pomodoro')
        .addIntegerOption((opt) =>
          opt
            .setName('minutos')
            .setDescription(`Duração do Pomodoro (1 a ${MAX_POMODORO_MINUTES} minutos, padrão 25)`)
            .setMinValue(1)
            .setMaxValue(MAX_POMODORO_MINUTES),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('parar').setDescription('Encerra o Pomodoro, desmuta todos e sai da sala'),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Mostra o Pomodoro atual')),

  async execute(interaction, { manager, store, config }) {
    const { guildId } = interaction;
    const session = manager.get(guildId);

    switch (interaction.options.getSubcommand()) {
      case 'iniciar': {
        const minutes = interaction.options.getInteger('minutos');
        const durationMs = minutes ? minutes * MINUTE_MS : config.pomodoroMs;
        // Avisos (Pomodoro já ativo, sala errada...) são respondidos só para quem usou o comando.
        const announcement = await manager.start(interaction, durationMs, () =>
          interaction.deferReply(),
        );
        await interaction.editReply(announcement);
        return;
      }

      case 'parar': {
        if (!session) throw new UserError('Não há nenhum Pomodoro ativo.');
        if (!session.canControl(interaction.member)) {
          throw new UserError(`Só quem está em ${session.voiceChannel} pode parar o Pomodoro.`);
        }
        await interaction.deferReply();
        await manager.stop(guildId, 'command');
        await interaction.editReply(
          `⏹️ Pomodoro encerrado por ${interaction.user}. Microfones liberados e saí da sala.`,
        );
        return;
      }

      case 'status': {
        const channelId = store.get(guildId).voiceChannelId;
        let content: string;
        if (session?.phase === 'focus') {
          content = `🍅 Foco em andamento em ${session.voiceChannel} — termina ${discordRelativeTime(session.endsAt)}.`;
        } else if (session?.phase === 'awaiting') {
          content = `⏰ O Pomodoro acabou em ${session.voiceChannel}; aguardando para começar outro.`;
        } else {
          content = channelId
            ? `💤 Nenhum Pomodoro ativo. Sala configurada: <#${channelId}>.`
            : '💤 Nenhum Pomodoro ativo e nenhuma sala configurada (use `/config sala`).';
        }
        await interaction.reply({ content, flags: 'Ephemeral' });
        return;
      }
    }
  },
};
