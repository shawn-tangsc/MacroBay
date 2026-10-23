/**
 * The event identity carried by a macro evidence reference.
 *
 * `macro-calendar:<sourceId>:<eventKey>` keeps the event key losslessly, including the dots
 * in official keys (`US.CPI.RELEASE.2026-M08`) that `factId` sanitises to dashes. Kept as a
 * dependency-free leaf so context construction can read it without pulling in the matcher
 * (which imports the macro calendar) and creating an import cycle.
 */
export function eventKeyOfEvidenceRef(evidenceRefId: string | null | undefined): string | null {
  if (typeof evidenceRefId !== 'string') return null
  const first = evidenceRefId.indexOf(':')
  if (first < 0) return null
  const rest = evidenceRefId.slice(first + 1)
  const second = rest.indexOf(':')
  if (second < 0) return null
  return rest.slice(second + 1) || null
}
