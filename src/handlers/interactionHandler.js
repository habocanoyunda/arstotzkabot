import { Collection } from 'discord.js';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load all command files once at startup
const commands = new Collection();

export async function loadCommands() {
  const commandsPath = join(__dirname, '../commands');
  const files = (await readdir(commandsPath)).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const mod = await import(join(commandsPath, file));
    commands.set(mod.data.name, mod);
  }

  console.log(`[commands] Loaded: ${[...commands.keys()].join(', ')}`);
}

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[interaction] Error in /${interaction.commandName}:`, err);
    const msg = { content: 'An error occurred while executing this command.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
}
