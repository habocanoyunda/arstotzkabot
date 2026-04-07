import { Client, GatewayIntentBits, Events } from 'discord.js';
import { createServer } from 'http';
import { config } from './config.js';
import { initDb } from './db/database.js';
import { loadCommands, handleInteraction } from './handlers/interactionHandler.js';
import { handleMention } from './handlers/mentionHandler.js';

// Crash early on unhandled rejections rather than silently corrupting state
process.on('unhandledRejection', (err) => {
  console.error('[process] Unhandled rejection:', err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
  await loadCommands();
});

client.on(Events.InteractionCreate, handleInteraction);

client.on(Events.MessageCreate, async (message) => {
  // Ignore bots and DMs — bot is guild-only
  if (message.author.bot || !message.guildId) return;
  await handleMention(message, client.user.id);
});

// Init DB before connecting to Discord
initDb();
client.login(config.discordToken);

// Render requires a bound port to keep the service alive
// UptimeRobot pings this endpoint to prevent sleep
const PORT = process.env.PORT || 3000;
createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(PORT, () => console.log(`[health] Listening on port ${PORT}`));
