import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * How a prompt or an answer is written to the call record and read back.
 *
 * The value is JSON-serialized and gzipped: the retention promise ("30 days, or 100 MB") is measured
 * against the bytes on disk, so storing the text raw would shorten the real window while the copy
 * still said thirty days. `bytes` and `sha256` describe the **decoded** JSON so a post-mortem can
 * compare shapes even after the body is gone.
 *
 * The three "not readable" states stay distinct: a call still in flight, a body withheld because it
 * carried something key-shaped, and a body whose gzip no longer parses. Collapsing them into "empty"
 * is the one failure the reader would act on.
 */
export type AnalysisIoStoredValue =
  | Readonly<{ state: 'read'; value: unknown }>
  | Readonly<{ state: 'corrupt' }>
  | Readonly<{ state: 'withheld' }>
  | Readonly<{ state: 'absent' }>

export function encodeAnalysisIoValue(value: unknown): Readonly<{ gzip: Uint8Array; bytes: number; sha256: string }> {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new Error('analysis-io-value-not-json')
  const buffer = Buffer.from(serialized, 'utf8')
  return Object.freeze({ gzip: gzipSync(buffer), bytes: buffer.byteLength, sha256: createHash('sha256').update(buffer).digest('hex') })
}

export function decodeAnalysisIoValue(gzip: Uint8Array | null, missingState: 'withheld' | 'absent'): AnalysisIoStoredValue {
  if (gzip == null) return Object.freeze({ state: missingState })
  try {
    return Object.freeze({ state: 'read', value: JSON.parse(gunzipSync(gzip).toString('utf8')) })
  } catch {
    // The row is not deleted: a corrupt archive is evidence, and the age policy will collect it.
    return Object.freeze({ state: 'corrupt' })
  }
}
