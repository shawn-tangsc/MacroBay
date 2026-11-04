/**
 * The byte budget checks a public query DTO is held to.
 *
 * One implementation, because two caps that "both mean the same thing" drift: a DTO can then pass one
 * check and be refused by the other, and the refusal surfaces far from the cap that caused it.
 */

/** Shared byte budget check: a second implementation would let two DTO caps drift apart. */
export function isWithinUtf8JsonBudget(value: unknown, maximumBytes: number): boolean {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && new TextEncoder().encode(serialized).byteLength <= maximumBytes
  } catch {
    return false
  }
}
