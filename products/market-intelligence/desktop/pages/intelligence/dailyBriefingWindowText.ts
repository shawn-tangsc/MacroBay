/** Replace the fixed 24-hour phrases in the brief copy with the edition's configured window. */
export function withWindowHours<T>(value: T, hours: number): T {
  if (hours === 24) return value
  if (typeof value === 'string') {
    return value
      .replace(/过去 24 小时/g, `过去 ${hours} 小时`)
      .replace(/24 小时/g, `${hours} 小时`)
      .replace(/Last 24 hours/gi, `Last ${hours} hours`)
      .replace(/Past 24 hours/gi, `Past ${hours} hours`)
      .replace(/\b24h\b/g, `${hours}h`) as T
  }
  if (Array.isArray(value)) return value.map((entry) => withWindowHours(entry, hours)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withWindowHours(entry, hours)])) as T
  }
  return value
}
