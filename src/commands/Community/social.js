import { SlashCommandBuilder, ChannelType, PermissionsBitField } from 'discord.js';
import { saveSocialFeed, getSocialFeeds } from '../../services/socialFeedService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('social')
    .setDescription('Veröffentlicht neue Social-Media-Uploads in einem Discord-Kanal.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addStringOption(option =>
      option
        .setName('link')
        .setDescription('YouTube-Kanal oder RSS/Atom-Feed-URL')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Kanal für die Upload-Benachrichtigungen')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Rolle, die bei einem neuen Upload erwähnt wird')
        .setRequired(true)
    ),

  async execute(interaction, _guildConfig, client) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Dieser Befehl funktioniert nur auf einem Server.', ephemeral: true });
      return;
    }

    const link = interaction.options.getString('link', true).trim();
    const channel = interaction.options.getChannel('channel', true);
    const role = interaction.options.getRole('role', true);

    if (!/^https?:\/\//i.test(link)) {
      await interaction.reply({ content: 'Bitte gib einen vollständigen Link mit https:// an.', ephemeral: true });
      return;
    }

    const botMember = interaction.guild.members.me;
    const permissions = channel.permissionsFor(botMember);
    if (!permissions?.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks,
    ])) {
      await interaction.reply({
        content: 'Ich brauche im ausgewählten Kanal die Rechte „Kanal ansehen“, „Nachrichten senden“ und „Links einbetten“.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const existingFeeds = await getSocialFeeds(client, interaction.guildId);
      const feed = await saveSocialFeed(client, interaction.guildId, {
        url: link,
        channelId: channel.id,
        roleId: role.id,
        createdBy: interaction.user.id,
      });

      const replaced = existingFeeds.some(item => item.id === feed.id);
      await interaction.editReply(
        `✅ Social-Feed ${replaced ? 'aktualisiert' : 'eingerichtet'}.
Ich prüfe **${link}** regelmäßig und poste neue Uploads in <#${channel.id}> mit <@&${role.id}>.`
      );
    } catch (error) {
      await interaction.editReply(
        `❌ Der Feed konnte nicht eingerichtet werden: ${error.message || 'unbekannter Fehler'}`
      );
    }
  },
};