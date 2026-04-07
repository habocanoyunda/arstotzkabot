import 'dotenv/config';

// Fail fast if required env vars are missing — better to crash at startup than mid-request
const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'ANTHROPIC_API_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  // Rate limiter
  rateLimitMax: 15,
  rateLimitWindowMs: 60_000,

  // Claude
  claudeModel: 'claude-sonnet-4-6',
  maxInputLength: 2000,
};
