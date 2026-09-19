import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';

function parseHexColor(value) {
  if (!value) return null;

  const normalized = value.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error('Die Farbe muss ein Hex-Wert sein, zum Beispiel #5865F2 oder 5865F2.');
  }

  return Number.parseInt(normalized, 16);
}

export default {
  data: new SlashCommandBuilder()
    .setName('sendmsg')
    .setDescription('Sendet eine Nachricht in einen ausgewählten Kanal.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Der Text, der gesendet werden soll')
        .setRequired(true)
        .setMaxLength(4000)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Der Zielkanal')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('color')
        .setDescription('Optionale Embed-Farbe, z. B. #5865F2')
        .setRequired(false)
        .setMaxLength(9)
    ),

  async execute(interaction, _guildConfig, client) {
    const message = interaction.options.getString('message', true);
    const channel = interaction.options.getChannel('channel', true);
    const colorInput = interaction.options.getString('color');

    let color = null;
    try {
      color = parseHexColor(colorInput);
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
      return;
    }

    const botMember = interaction.guild?.members.me;
    const permissions = channel.permissionsFor(botMember);

    if (!permissions?.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      ...(color !== null ? [PermissionsBitField.Flags.EmbedLinks] : []),
    ])) {
      await interaction.reply({
        content: '❌ Ich habe im ausgewählten Kanal nicht die benötigten Rechte.',
        ephemeral: true,
      });
      return;
    }

    try {
      if (color === null) {
        await channel.send({
          content: message,
          allowedMentions: { parse: [] },
        });
      } else {
        await channel.send({
          embeds: [{
            description: message,
            color,
          }],
          allowedMentions: { parse: [] },
        });
      }

      await interaction.reply({
        content: `✅ Nachricht wurde in <#${channel.id}> gesendet.`,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content: `❌ Nachricht konnte nicht gesendet werden: ${error.message || 'unbekannter Fehler'}`,
        ephemeral: true,
      });
    }
  },
};
