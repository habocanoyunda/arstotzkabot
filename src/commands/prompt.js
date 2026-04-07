import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { reloadPrompts } from '../services/claude.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');

export const data = new SlashCommandBuilder()
  .setName('prompt')
  .setDescription('Edit the bot mention system prompt')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const promptPath = join(PROMPTS_DIR, 'mention.txt');
  const currentPrompt = existsSync(promptPath)
    ? readFileSync(promptPath, 'utf8')
    : '';

  const modal = new ModalBuilder()
    .setCustomId('prompt_edit_modal')
    .setTitle('Edit Mention System Prompt');

  const textInput = new TextInputBuilder()
    .setCustomId('prompt_text')
    .setLabel('System Prompt')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentPrompt.slice(0, 4000)) // Discord modal limit
    .setRequired(true)
    .setMaxLength(4000);

  modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  await interaction.showModal(modal);

  // Wait for modal submission
  let modalInteraction;
  try {
    modalInteraction = await interaction.awaitModalSubmit({
      filter: i => i.customId === 'prompt_edit_modal' && i.user.id === interaction.user.id,
      time: 300_000, // 5 minutes to fill out the form
    });
  } catch {
    return; // Timed out, no response needed
  }

  const newPrompt = modalInteraction.fields.getTextInputValue('prompt_text').trim();

  try {
    writeFileSync(promptPath, newPrompt, 'utf8');
    reloadPrompts();
    await modalInteraction.reply({
      content: 'System prompt updated and reloaded.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('[prompt] Failed to save prompt:', err);
    await modalInteraction.reply({
      content: 'Failed to save prompt. Check bot logs.',
      ephemeral: true,
    });
  }
}
