export type AllowedChatGuard = {
  allowedIds: string[]
  isAllowed: (chatId: string | number | null | undefined) => boolean
}

export function createAllowedChatGuard(allowedIds?: readonly string[]): AllowedChatGuard {
  const normalizedIds = (allowedIds ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
  const allowedSet = new Set(normalizedIds)

  return {
    allowedIds: normalizedIds,
    isAllowed(chatId) {
      const normalizedChatId = String(chatId ?? '').trim()
      if (!normalizedIds.length) return true
      return Boolean(normalizedChatId && allowedSet.has(normalizedChatId))
    }
  }
}
