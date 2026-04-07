import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getGuildConfig, getMemory, setMemory, clearMemory } from '../db/database.js';
import { hasJudgeRole, hasHistoryRole } from '../utils/permissionCheck.js';

export const data = new SlashCommandBuilder()
  .setName('memory')
  .setDescription('Manage user memory context')
  .addSubcommand(sub =>
    sub.setName('set')
      .setDescription('Set memory for a user')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption(opt => opt.setName('text').setDescription('Memory text').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('view')
      .setDescription('View memory for a user')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('clear')
      .setDescription('Clear memory for a user')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
  );

export async function execute(interaction) {
  const guildConfig = getGuildConfig(interaction.guildId);
  if (!guildConfig) {
    return interaction.reply({ content: 'Server not configured. Run /setup first.', ephemeral: true });
  }

  const subcommand = interaction.options.getSubcommand();
  const targetUser = interaction.options.getUser('user');
  const isJudge = await hasJudgeRole(interaction.member, interaction.guildId);
  const isHistory = await hasHistoryRole(interaction.member, interaction.guildId);

  // view is open to both judge and history roles; set/clear requires judge
  if (subcommand === 'view') {
    if (!isJudge && !isHistory) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }
  } else {
    if (!isJudge) {
      return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }
  }

  try {
    if (subcommand === 'set') {
      const text = interaction.options.getString('text').trim().slice(0, 1000);
      setMemory(interaction.guildId, targetUser.id, text, interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle('Memory Set')
        .setColor(0x57f287)
        .addFields(
          { name: 'User', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Set by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Memory', value: text },
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'view') {
      const memory = getMemory(interaction.guildId, targetUser.id);
      if (!memory) {
        return interaction.reply({ content: `No memory set for <@${targetUser.id}>.`, ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('User Memory')
        .setColor(0x5865f2)
        .addFields(
          { name: 'User', value: `<@${targetUser.id}>`, inline: true },
          { name: 'Set by', value: `<@${memory.set_by}>`, inline: true },
          { name: 'Memory', value: memory.memory_text },
        )
        .setTimestamp(memory.updated_at * 1000);

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (subcommand === 'clear') {
      const result = clearMemory(interaction.guildId, targetUser.id);
      const msg = result.changes > 0
        ? `Memory cleared for <@${targetUser.id}>.`
        : `No memory was set for <@${targetUser.id}>.`;
      return interaction.reply({ content: msg, ephemeral: true });
    }
  } catch (err) {
    console.error('[memory] Error:', err);
    return interaction.reply({ content: 'An error occurred. Please try again.', ephemeral: true });
  }
}
