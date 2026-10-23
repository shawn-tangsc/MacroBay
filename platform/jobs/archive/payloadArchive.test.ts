import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { archivePayload, hashPayload } from './payloadArchive'

describe('payloadArchive', () => {
  it('returns inline ref for small payloads', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'payload-archive-'))

    try {
      const ref = await archivePayload({
        baseDir: dir,
        payload: 'small-payload',
        inlineThresholdBytes: 1024
      })

      expect(ref.kind).toBe('inline')
      expect(ref.ref).toBe('inline')
      expect(ref.codec).toBe('inline')
      expect(ref.byteSize).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes large payloads under caller-provided base directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'payload-archive-'))

    try {
      const payload = 'x'.repeat(5000)
      const ref = await archivePayload({
        baseDir: dir,
        payload,
        inlineThresholdBytes: 100
      })

      expect(ref.kind).toBe('file')
      expect(ref.codec).toBe('file')
      expect(path.isAbsolute(ref.ref)).toBe(false)

      const stored = await readFile(path.join(dir, ref.ref))
      expect(stored.toString()).toBe(payload)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('produces stable content hash', () => {
    const first = hashPayload('stable-content')
    const second = hashPayload('stable-content')
    expect(first).toBe(second)
  })

  it('returns relative file refs and metadata size', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'payload-archive-'))

    try {
      const payload = 'y'.repeat(5000)
      const ref = await archivePayload({
        baseDir: dir,
        payload,
        inlineThresholdBytes: 100,
        fileNamePrefix: 'evidence'
      })

      expect(ref.ref.startsWith('evidence-')).toBe(true)
      expect(ref.ref.includes(dir)).toBe(false)
      expect(ref.byteSize).toBe(new TextEncoder().encode(payload).byteLength)
      expect(ref.contentHash).toHaveLength(64)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
