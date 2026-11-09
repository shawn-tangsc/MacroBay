/**
 * Claude SDK 返回值的最小读取器：把「可能不是 JSON / 可能是任意值」的东西变成一个字符串或一个值。
 *
 * 单独成文件是因为它们与驱动装配无关、只做取值归一；驱动文件已经很长，再往里塞帮手只会更难读。
 */
export function serializeClaudeSdkUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function safeParseClaudeSdkJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}
