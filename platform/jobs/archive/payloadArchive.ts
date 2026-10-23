import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type PayloadArchiveCodec = 'inline' | 'file'

export type PayloadArchiveRef = {
  kind: PayloadArchiveCodec
  ref: string
  contentHash: string
  byteSize: number
  codec: PayloadArchiveCodec
}

export type ArchivePayloadInput = {
  baseDir: string
  payload: string | Uint8Array
  inlineThresholdBytes?: number
  fileNamePrefix?: string
}

const DEFAULT_INLINE_THRESHOLD = 4_096

export async function archivePayload(input: ArchivePayloadInput): Promise<PayloadArchiveRef> {
  const bytes = toBytes(input.payload)
  const byteSize = bytes.byteLength
  const contentHash = hashBytes(bytes)
  const threshold = input.inlineThresholdBytes ?? DEFAULT_INLINE_THRESHOLD

  if (byteSize <= threshold) {
    return {
      kind: 'inline',
      ref: 'inline',
      contentHash,
      byteSize,
      codec: 'inline'
    }
  }

  await mkdir(input.baseDir, { recursive: true })
  const fileName = `${input.fileNamePrefix ?? 'payload'}-${contentHash.slice(0, 16)}.bin`
  const absolutePath = path.join(input.baseDir, fileName)
  await writeFile(absolutePath, bytes)

  return {
    kind: 'file',
    ref: fileName,
    contentHash,
    byteSize,
    codec: 'file'
  }
}

export function hashPayload(payload: string | Uint8Array): string {
  return hashBytes(toBytes(payload))
}

function toBytes(payload: string | Uint8Array): Uint8Array {
  if (typeof payload === 'string') {
    return new TextEncoder().encode(payload)
  }
  return payload
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
