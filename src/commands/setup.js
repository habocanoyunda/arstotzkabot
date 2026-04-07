import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ComponentType,
} from 'discord.js';
import { getGuildConfig, upsertGuildConfig } from '../db/database.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the bot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const guild = interaction.guild;
  const existing = getGuildConfig(guild.id);

  // Fetch all roles for the select menus
  await guild.roles.fetch();
  const roles = guild.roles.cache
    .filter(r => !r.managed && r.id !== guild.id) // exclude @everyone and bot-managed roles
    .sort((a, b) => b.position - a.position)
    .map(r => ({ label: r.name, value: r.id }))
    .slice(0, 25); // Discord select menu max

  if (roles.length === 0) {
    return interaction.reply({ content: 'No eligible roles found on this server.', ephemeral: true });
  }

  const existingInfo = existing
    ? `\nCurrent config:\n- Judge role: <@&${existing.judge_role_id}>\n- History role: <@&${existing.history_role_id}>`
    : '';

  const judgeMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_judge_role')
      .setPlaceholder('Select judge/moderator role')
      .addOptions(roles)
  );

  const reply = await interaction.reply({
    content: `**Bot Setup**${existingInfo}\n\nStep 1/2: Select the role that can use \`/judge\` and \`/memory\`.`,
    components: [judgeMenu],
    ephemeral: true,
  });

  let judgeRoleId;
  try {
    const judgeInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: i => i.customId === 'setup_judge_role' && i.user.id === interaction.user.id,
      time: 60_000,
    });

    judgeRoleId = judgeInteraction.values[0];

    // Validate it's still a real role
    if (!guild.roles.cache.has(judgeRoleId)) {
      return judgeInteraction.update({ content: 'Selected role no longer exists.', components: [] });
    }

    const historyMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup_history_role')
        .setPlaceholder('Select history viewer role')
        .addOptions(roles)
    );

    await judgeInteraction.update({
      content: `Step 2/2: Select the role that can use \`/history\` (can be broader than judge role).`,
      components: [historyMenu],
    });

    const historyInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: i => i.customId === 'setup_history_role' && i.user.id === interaction.user.id,
      time: 60_000,
    });

    const historyRoleId = historyInteraction.values[0];

    if (!guild.roles.cache.has(historyRoleId)) {
      return historyInteraction.update({ content: 'Selected role no longer exists.', components: [] });
    }

    upsertGuildConfig(guild.id, judgeRoleId, historyRoleId);

    const embed = new EmbedBuilder()
      .setTitle('Setup Complete')
      .setColor(0x57f287)
      .addFields(
        { name: 'Judge / Memory role', value: `<@&${judgeRoleId}>`, inline: true },
        { name: 'History role', value: `<@&${historyRoleId}>`, inline: true },
      )
      .setTimestamp();

    await historyInteraction.update({ content: '', embeds: [embed], components: [] });
  } catch {
    // Timeout — clean up the message
    await interaction.editReply({ content: 'Setup timed out.', components: [] }).catch(() => {});
  }
}
