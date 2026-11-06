/**
 * The two read helpers the fact layer and the localized layer share: a failed read becomes a stated
 * gap, never a thrown generation. Kept in one module so the two layers cannot drift.
 */
export const HOUR_MS = 60 * 60 * 1_000
export const DAY_MS = 24 * 60 * 60 * 1_000

export async function safe<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch {
    return fallback
  }
}

export function safeSync<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}
