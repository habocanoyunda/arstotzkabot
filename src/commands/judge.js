import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getGuildConfig, getCaseHistory, getMemory, insertCase } from '../db/database.js';
import { judgeCase } from '../services/claude.js';
import { hasJudgeRole } from '../utils/permissionCheck.js';

// Verdict color coding for the embed
const VERDICT_COLORS = {
  acquit: 0x57f287,  // green
  warn:   0xfee75c,  // yellow
  mute:   0xff9900,  // orange
  timeout: 0xff9900,
  jail:   0xe67e22,
  ban:    0xed4245,  // red
};

export const data = new SlashCommandBuilder()
  .setName('judge')
  .setDescription('Request an AI verdict for a moderation case')
  .addUserOption(opt =>
    opt.setName('user').setDescription('The user to judge').setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('incident').setDescription('Description of the incident').setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('evidence').setDescription('Evidence (text, message links, etc.)').setRequired(false)
  );

export async function execute(interaction) {
  const guildConfig = getGuildConfig(interaction.guildId);
  if (!guildConfig) {
    return interaction.reply({ content: 'Server not configured. Run /setup first.', ephemeral: true });
  }

  if (!(await hasJudgeRole(interaction.member, interaction.guildId))) {
    return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  const incident = interaction.options.getString('incident').trim().slice(0, 2000);
  const evidence = interaction.options.getString('evidence')?.trim().slice(0, 2000) ?? null;

  // Defer because Claude call can take a moment
  await interaction.deferReply();

  try {
    const history = getCaseHistory(interaction.guildId, targetUser.id, 10);
    const memory = getMemory(interaction.guildId, targetUser.id);

    const result = await judgeCase({
      incident,
      evidence,
      history,
      memoryText: memory?.memory_text ?? null,
      targetUsername: targetUser.username,
    });

    const { verdict, duration_minutes, reasoning } = result;

    insertCase({
      guildId: interaction.guildId,
      targetUserId: targetUser.id,
      judgeUserId: interaction.user.id,
      verdict,
      reasoning,
      evidence,
      durationMinutes: duration_minutes,
    });

    const durationText = duration_minutes ? `${duration_minutes} minutes` : null;

    const embed = new EmbedBuilder()
      .setTitle(`Verdict: ${verdict.toUpperCase()}`)
      .setColor(VERDICT_COLORS[verdict] ?? 0x99aab5)
      .addFields(
        { name: 'Target', value: `<@${targetUser.id}>`, inline: true },
        { name: 'Requested by', value: `<@${interaction.user.id}>`, inline: true },
      )
      .addFields({ name: 'Incident', value: incident.slice(0, 1024) });

    if (evidence) embed.addFields({ name: 'Evidence', value: evidence.slice(0, 1024) });
    if (durationText) embed.addFields({ name: 'Duration', value: durationText, inline: true });

    embed
      .addFields({ name: 'Reasoning', value: reasoning.slice(0, 1024) })
      .setFooter({ text: 'Bot suggests verdict — moderator applies action' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[judge] Error:', err);
    await interaction.editReply({ content: 'AI unavailable, please try again.' });
  }
}
