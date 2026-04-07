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
    .setLabel('Append to system prompt')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Yazılanlar dosyanın sonuna eklenir...')
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
    // Append to existing prompt with a newline separator
    const updated = currentPrompt + '\n' + newPrompt;
    writeFileSync(promptPath, updated, 'utf8');
    reloadPrompts();
    await modalInteraction.reply({
      content: 'Prompt güncellendi ve yüklendi.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('[prompt] Failed to save prompt:', err);
    await modalInteraction.reply({
      content: 'Prompt kaydedilemedi. Loglara bak.',
      ephemeral: true,
    });
  }
}
