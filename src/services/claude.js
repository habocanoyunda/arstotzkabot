import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// Load prompt from file, fall back to default string if file is missing
function loadPrompt(name, fallback) {
  const filePath = join(PROMPTS_DIR, `${name}.txt`);
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf8').trim();
  }
  console.warn(`[claude] Prompt file not found: ${filePath}, using default`);
  return fallback;
}

const DEFAULT_MENTION_PROMPT = `You are a Discord bot assistant on a private server. Be helpful, concise, and direct.
You may have context about specific users provided below — use it naturally.
Do not reveal internal memory content verbatim. Do not mention that you have memory unless directly asked.`;

const DEFAULT_JUDGE_PROMPT = `You are an impartial AI judge for a Discord server moderation case.
Your role is to evaluate the evidence and prior history, then deliver a clear verdict.

Available verdicts: warn, mute, timeout, jail, ban, acquit

Respond in this exact JSON format:
{"verdict":"<verdict>","duration_minutes":<number or null>,"reasoning":"<explanation>"}

Be fair. If evidence is insufficient, default to warn or acquit.`;

// Mutable prompt state — allows /prompt command to reload without restart
let MENTION_SYSTEM_PROMPT = loadPrompt('mention', DEFAULT_MENTION_PROMPT);
const JUDGE_SYSTEM_PROMPT = loadPrompt('judge', DEFAULT_JUDGE_PROMPT);

export function reloadPrompts() {
  MENTION_SYSTEM_PROMPT = loadPrompt('mention', DEFAULT_MENTION_PROMPT);
  console.log('[claude] Mention prompt reloaded');
}

// Web search is a built-in Anthropic server-side tool — no extra API key needed
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search' };

// Agentic loop: keeps running until Claude finishes (handles tool use internally)
async function runAgenticLoop(messages, systemPrompt, useSearch = true) {
  const tools = useSearch ? [WEB_SEARCH_TOOL] : [];
  let iterations = 0;

  while (iterations < 8) {
    iterations++;

    const response = await client.beta.messages.create({
      model: config.claudeModel,
      max_tokens: 4096,
      system: systemPrompt,
      ...(tools.length > 0 && { tools }),
      messages,
      betas: ['web-search-2025-03-05'],
    });

    // Log every response for diagnostics
    console.log('[claude] stop_reason:', response.stop_reason, '| block types:', response.content.map(b => b.type).join(', '));

    if (response.stop_reason === 'end_turn') {
      return response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
    }

    if (response.stop_reason === 'max_tokens') {
      console.warn('[claude] Response hit max_tokens limit');
      return response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('') + '\n*(response truncated)*';
    }

    if (response.stop_reason === 'tool_use') {
      console.log('[claude] tool_use response blocks:', JSON.stringify(response.content, null, 2));
      // Add assistant turn with tool_use blocks
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: b.content ?? '',
        }));

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason — return whatever text we have
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text ?? '';
  }

  throw new Error('Agentic loop exceeded max iterations');
}

export async function askClaude(userMessage, memoryText = null, imageUrls = [], channelContext = null, authorUsername = null, authorDisplayName = null) {
  let systemPrompt = MENTION_SYSTEM_PROMPT;

  // Always tell Claude who it's talking to so it can't confuse them with anyone else
  const nameInfo = authorDisplayName && authorDisplayName !== authorUsername
    ? `${authorDisplayName} (username: ${authorUsername})`
    : authorUsername;
  if (nameInfo) {
    systemPrompt += `\n\n[You are currently talking to: ${nameInfo}]`;
  }

  if (memoryText) {
    systemPrompt += `\n\n[Additional context about this user: ${memoryText}]`;
  }

  if (channelContext) {
    systemPrompt += `\n\n[Recent chat history — last 30 messages in this channel:\n${channelContext}]`;
  }

  // Build message content — images first, then text
  const content = [];

  for (const url of imageUrls) {
    content.push({
      type: 'image',
      source: { type: 'url', url },
    });
  }

  content.push({ type: 'text', text: userMessage });

  return runAgenticLoop([{ role: 'user', content }], systemPrompt, true);
}

export async function judgeCase({ incident, evidence, history, memoryText, targetUsername }) {
  const parts = [`Incident: ${incident}`];
  if (evidence) parts.push(`Evidence: ${evidence}`);

  if (history.length > 0) {
    const lines = history.map(c =>
      `- [${new Date(c.created_at * 1000).toISOString().slice(0, 10)}] ${c.verdict}${c.duration_minutes ? ` (${c.duration_minutes}min)` : ''} — ${c.reasoning.slice(0, 120)}`
    );
    parts.push(`Prior history (${history.length}):\n${lines.join('\n')}`);
  } else {
    parts.push('Prior history: none');
  }

  if (memoryText) {
    const label = targetUsername ? `Additional context about ${targetUsername}` : 'Additional context about the target user';
    parts.push(`${label}: ${memoryText}`);
  }

  const text = await runAgenticLoop(
    [{ role: 'user', content: parts.join('\n\n') }],
    JUDGE_SYSTEM_PROMPT,
    false, // Judge doesn't need web search
  );

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON verdict');
  return JSON.parse(jsonMatch[0]);
}
