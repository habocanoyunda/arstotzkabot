// Run this script once (or after changing command definitions) to register slash commands with Discord.
// Usage: node deploy-commands.js
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const commandsPath = join(__dirname, 'src/commands');
const files = (await readdir(commandsPath)).filter(f => f.endsWith('.js'));

const commands = [];
for (const file of files) {
  const mod = await import(join(commandsPath, file));
  commands.push(mod.data.toJSON());
}

console.log(`Registering ${commands.length} command(s)...`);

await rest.put(
  Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
  { body: commands },
);

console.log('Done.');
