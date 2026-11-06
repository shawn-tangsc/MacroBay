import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type PublishArtifactsResult = Readonly<{
  /** Files whose bytes differed from what was on disk, and were therefore replaced. */
  written: readonly string[]
  /** Files that were already byte-identical: their mtime is untouched. */
  unchanged: readonly string[]
}>

/**
 * Copies generated artifacts into place, writing only the ones whose content changed.
 *
 * Why this exists: a generator that rewrites identical content still bumps the mtime, and the
 * full-gate run counts every file touched while it runs as pollution — an idempotent run would
 * void the very gate it was part of. Comparing first and skipping the write makes a second
 * `generate:*` run leave the tree exactly as it found it.
 */
export function publishGeneratedArtifacts(
  stagingDir: string,
  outputDir: string,
  fileNames: readonly string[]
): PublishArtifactsResult {
  const written: string[] = []
  const unchanged: string[] = []
  for (const fileName of fileNames) {
    const next = readFileSync(join(stagingDir, fileName))
    let current: Buffer | undefined
    try {
      current = readFileSync(join(outputDir, fileName))
    } catch {
      // A missing artifact is the normal first run: it has to be written.
    }
    if (current !== undefined && current.equals(next)) {
      unchanged.push(fileName)
      continue
    }
    writeFileSync(join(outputDir, fileName), next)
    written.push(fileName)
  }
  return { written, unchanged }
}
