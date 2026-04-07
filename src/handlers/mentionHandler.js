import { getGuildConfig, getMemory } from '../db/database.js';
import { askClaude } from '../services/claude.js';
import { checkRateLimit } from '../services/rateLimiter.js';
import { hasBotAccess } from '../utils/permissionCheck.js';
import { config } from '../config.js';

const CONTEXT_LIMIT = 30;

// Fetches recent channel messages to give Claude awareness of the conversation
async function fetchChannelContext(channel, currentMessageId) {
  try {
    const fetched = await channel.messages.fetch({ limit: CONTEXT_LIMIT + 1 });
    return fetched
      .filter(m => m.id !== currentMessageId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .last(CONTEXT_LIMIT)
      .map(m => {
        const text = m.content.replace(/<@!?\d+>/g, '').trim();
        return text ? `[${m.author.username}]: ${text}` : null;
      })
      .filter(Boolean)
      .join('\n');
  } catch {
    return null; // context is best-effort, don't crash if it fails
  }
}

// Splits a long response into <=2000 char chunks, breaking at newlines where possible
function splitMessage(text, maxLen = 2000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf(' ', maxLen); // fallback to word boundary
    if (cut <= 0) cut = maxLen; // last resort hard cut
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// Discord attachment content types that Claude can analyze
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export async function handleMention(message, clientId) {
  if (!message.mentions.users.has(clientId)) return;

  const guildConfig = getGuildConfig(message.guildId);
  if (!guildConfig) return;

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  if (!(await hasBotAccess(member, message.guildId))) return;

  const { allowed } = checkRateLimit(message.author.id);
  if (!allowed) {
    return message.reply('You\'re sending messages too fast. Please wait a moment before trying again.');
  }

  const prompt = message.content
    .replace(/<@!?\d+>/g, '')
    .trim()
    .slice(0, config.maxInputLength);

  // Collect image attachments from the message
  const imageUrls = message.attachments
    .filter(a => SUPPORTED_IMAGE_TYPES.includes(a.contentType))
    .map(a => a.url);

  if (!prompt && imageUrls.length === 0) {
    return message.reply('Hey! How can I help you?');
  }

  // Use a default prompt if only images were sent with no text
  const userMessage = prompt || 'Please analyze this image.';

  await message.channel.sendTyping();

  try {
    const memory = getMemory(message.guildId, message.author.id);
    const channelContext = await fetchChannelContext(message.channel, message.id);
    const displayName = member.displayName ?? message.author.username;
    const response = await askClaude(userMessage, memory?.memory_text ?? null, imageUrls, channelContext, message.author.username, displayName);
    const chunks = splitMessage(response);
    await message.reply(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      await message.channel.send(chunk);
    }
  } catch (err) {
    console.error('[mention] Claude error:', err);
    await message.reply('AI unavailable, please try again.');
  }
}
