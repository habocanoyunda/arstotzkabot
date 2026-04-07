import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { getGuildConfig, getCaseHistory, getCaseCount } from '../db/database.js';
import { hasHistoryRole } from '../utils/permissionCheck.js';

const PAGE_SIZE = 5;

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('View moderation case history for a user')
  .addUserOption(opt =>
    opt.setName('user').setDescription('The user to look up').setRequired(true)
  );

export async function execute(interaction) {
  const guildConfig = getGuildConfig(interaction.guildId);
  if (!guildConfig) {
    return interaction.reply({ content: 'Server not configured. Run /setup first.', ephemeral: true });
  }

  if (!(await hasHistoryRole(interaction.member, interaction.guildId))) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  const total = getCaseCount(interaction.guildId, targetUser.id);

  if (total === 0) {
    return interaction.reply({
      content: `No case history found for <@${targetUser.id}>.`,
      ephemeral: true,
    });
  }

  let page = 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const buildEmbed = (page) => {
    // Fetch only the current page — offset via JS slice since total is small
    const all = getCaseHistory(interaction.guildId, targetUser.id, 100);
    const entries = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    const embed = new EmbedBuilder()
      .setTitle(`Case History — ${targetUser.username}`)
      .setColor(0x5865f2)
      .setFooter({ text: `Page ${page + 1}/${totalPages} · ${total} total cases` });

    for (const c of entries) {
      const date = new Date(c.created_at * 1000).toISOString().slice(0, 10);
      const summary = c.reasoning.slice(0, 100) + (c.reasoning.length > 100 ? '…' : '');
      const duration = c.duration_minutes ? ` (${c.duration_minutes}min)` : '';
      embed.addFields({
        name: `[${date}] ${c.verdict.toUpperCase()}${duration} — Judge: <@${c.judge_user_id}>`,
        value: summary,
      });
    }

    return embed;
  };

  const buildButtons = (page) => new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('hist_prev')
      .setLabel('← Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('hist_next')
      .setLabel('Next →')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );

  const reply = await interaction.reply({
    embeds: [buildEmbed(page)],
    components: totalPages > 1 ? [buildButtons(page)] : [],
    ephemeral: true,
  });

  if (totalPages <= 1) return;

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === interaction.user.id,
    time: 120_000,
  });

  collector.on('collect', async i => {
    if (i.customId === 'hist_prev') page = Math.max(0, page - 1);
    if (i.customId === 'hist_next') page = Math.min(totalPages - 1, page + 1);
    await i.update({ embeds: [buildEmbed(page)], components: [buildButtons(page)] });
  });

  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}
