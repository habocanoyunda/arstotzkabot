import { getGuildConfig } from '../db/database.js';

export async function hasJudgeRole(member, guildId) {
  const config = getGuildConfig(guildId);
  if (!config?.judge_role_id) return false;
  return member.roles.cache.has(config.judge_role_id);
}

export async function hasHistoryRole(member, guildId) {
  const config = getGuildConfig(guildId);
  if (!config?.history_role_id) return false;
  return member.roles.cache.has(config.history_role_id);
}

export async function hasBotAccess(member, guildId) {
  const config = getGuildConfig(guildId);
  if (!config) return false;
  return (
    (config.judge_role_id && member.roles.cache.has(config.judge_role_id)) ||
    (config.history_role_id && member.roles.cache.has(config.history_role_id))
  );
}
