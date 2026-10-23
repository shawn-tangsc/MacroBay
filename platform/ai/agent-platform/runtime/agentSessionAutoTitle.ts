const DEFAULT_SESSION_NAMES = new Set(['session', 'new agent session', '新的智能体会话', '新的会话'])
const MAX_TITLE_WORDS = 7
const MAX_TITLE_LENGTH = 48

export function shouldAutoRenameAgentSession(name: string): boolean {
  return DEFAULT_SESSION_NAMES.has(name.trim().toLowerCase())
}

export function buildAgentSessionAutoTitle(text: string): string | null {
  const normalized = text
    .replace(/[`*_#[\](){}<>-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return null

  const words = normalized.split(' ').filter(Boolean)
  const wordTitle = words.slice(0, MAX_TITLE_WORDS).join(' ')
  const title = wordTitle.length > MAX_TITLE_LENGTH ? `${wordTitle.slice(0, MAX_TITLE_LENGTH).trim()}...` : wordTitle
  return title || null
}
