import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { MAX_POMODORO_MINUTES, MINUTE_MS } from '../config.js';
import { UserError } from '../errors.js';
import { statusMessage, stoppedMessage } from '../pomodoro/messages.js';
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
        await manager.start(interaction, durationMs, () => interaction.deferReply());
        return;
      }

      case 'parar': {
        if (!session) throw new UserError('Não há nenhum Pomodoro ativo.');
        if (!session.canControl(interaction.member)) {
          throw new UserError(`Só quem está em ${session.voiceChannel} pode parar o Pomodoro.`);
        }
        await interaction.deferReply();
        await manager.stop(guildId, 'command');
        await interaction.editReply(stoppedMessage(interaction.client, interaction.user.id));
        return;
      }

      case 'status': {
        const { client } = interaction;
        const message =
          session?.phase === 'focus' || session?.phase === 'break'
            ? statusMessage(client, {
                phase: session.phase,
                voiceChannel: session.voiceChannel,
                endsAt: session.endsAt,
              })
            : session?.phase === 'awaiting'
              ? statusMessage(client, { phase: 'awaiting', voiceChannel: session.voiceChannel })
              : statusMessage(client, {
                  phase: 'idle',
                  configuredChannelId: store.get(guildId).voiceChannelId,
                });
        await interaction.reply({ ...message, flags: 'Ephemeral' });
        return;
      }
    }
  },
};
