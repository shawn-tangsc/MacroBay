const SLASH_COMMANDS = new Set(['new', 'compact', 'help', 'whoami'])

export function isSlashCommand(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return false
  const command = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  return SLASH_COMMANDS.has(command)
}

export function parseSlashCommand(text: string): string | null {
  if (!isSlashCommand(text)) return null
  return text.trim().split(/\s+/, 1)[0] ?? null
}
