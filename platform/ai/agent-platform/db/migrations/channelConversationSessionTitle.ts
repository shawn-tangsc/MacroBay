import type { AgentPlatformMigration } from '../createAgentPlatformDatabase'

/**
 * 会话名落在会话行上。
 *
 * 为什么存一份而不是每次去 Agent 存储里查：投递回执要能立刻说「已发给 Telegram · 贾维斯」，
 * 而会话名是**创建时**按界面语言算出来的；存下来既能跨重启稳定，也不会因为语言切换把已有会话改名。
 * 只在创建/换会话时写入，读者改过名字的会话永远不动。
 */
export const channelConversationSessionTitle: AgentPlatformMigration[] = [
  {
    id: '0052_channel_conversation_session_title',
    up: `
      alter table channel_conversations add column session_title text;
    `
  }
]
