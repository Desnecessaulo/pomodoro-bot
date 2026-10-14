import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types.js';

export const configCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configura o Pomodoro BOT neste servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('sala')
        .setDescription('Define a sala de voz usada pelo Pomodoro')
        .addChannelOption((opt) =>
          opt
            .setName('canal')
            .setDescription('Sala de voz do Pomodoro')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('ver').setDescription('Mostra a configuração atual')),

  async execute(interaction, { store, manager }) {
    const { guildId } = interaction;

    if (interaction.options.getSubcommand() === 'ver') {
      const channelId = store.get(guildId).voiceChannelId;
      await interaction.reply({
        content: channelId
          ? `🔊 Sala do Pomodoro: <#${channelId}>`
          : 'Nenhuma sala configurada. Use `/config sala`.',
        flags: 'Ephemeral',
      });
      return;
    }

    const channel = interaction.options.getChannel('canal', true, [ChannelType.GuildVoice]);
    await store.update(guildId, (g) => {
      g.voiceChannelId = channel.id;
    });

    const notes: string[] = [];
    const me = interaction.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.MuteMembers])) {
      notes.push('⚠️ Eu preciso das permissões **Conectar** e **Silenciar membros** nessa sala.');
    }
    if (!perms?.has(PermissionFlagsBits.SetVoiceChannelStatus)) {
      notes.push(
        'ℹ️ Sem a permissão **Definir status do canal de voz** não consigo mostrar "POMODORO ROLANDO" na sala.',
      );
    }
    if (manager.get(guildId)) {
      notes.push('ℹ️ A mudança vale a partir do próximo Pomodoro.');
    }

    await interaction.reply({
      content: [`✅ Sala do Pomodoro definida: ${channel}`, ...notes].join('\n'),
      flags: 'Ephemeral',
    });
  },
};
