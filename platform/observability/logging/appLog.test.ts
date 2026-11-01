import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAppLog } from './appLog'
import { redactText } from '../../secrets/redaction/redactText'

describe('createAppLog', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'macrobay-app-log-'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes one readable structured line per call under app.log', async () => {
    const directory = join(root, 'structured')
    const log = createAppLog({
      directory,
      redact: (text) => text,
      now: () => new Date('2026-11-01T01:00:00.000Z')
    })

    log.log('info', 'app.start', { version: '0.3.0' })

    expect(log.path).toBe(join(directory, 'app.log'))
    const lines = (await readFile(log.path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      time: '2026-11-01T01:00:00.000Z',
      level: 'info',
      event: 'app.start',
      version: '0.3.0'
    })
  })

  it('writes through the redactor, so the credential never reaches the file', async () => {
    const directory = join(root, 'redacted')
    const fakeKey = 'sk-proj-0123456789abcdefghijABCDEFGHIJ'
    const log = createAppLog({
      directory,
      redact: (text) => redactText(text).text
    })

    log.log('error', 'provider.test', { apiKey: fakeKey })

    const text = await readFile(log.path, 'utf8')
    expect(text).not.toContain(fakeKey)
    expect(text).toContain('[REDACTED]')
    expect(JSON.parse(text.trim())).toMatchObject({ level: 'error', event: 'provider.test' })
  })

  it('rotates inside the writer and drops the oldest file when the total cap is crossed', async () => {
    const directory = join(root, 'rotated')
    // 滚动预算正好等于 3 个满文件：活动文件不该被算进这笔预算。
    const limits = { maxFileBytes: 320, maxRolledFiles: 3, maxRotatedBytes: 960 }
    const log = createAppLog({ directory, redact: (text) => text, limits })

    for (let index = 0; index < 80; index++) log.log('info', 'tick', { index })

    const names = (await readdir(directory)).sort()
    const sizes = await Promise.all(names.map(async (name) => (await stat(join(directory, name))).size))
    // 活动文件 + 3 个滚动文件都在：把活动文件算进总量会提前删掉一个滚轮。
    expect(names).toHaveLength(limits.maxRolledFiles + 1)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(limits.maxFileBytes)
    const totalBytes = sizes.reduce((total, size) => total + size, 0)
    const rolledBytes = totalBytes - (await stat(log.path)).size
    expect(rolledBytes).toBeLessThanOrEqual(limits.maxRotatedBytes)
    expect(totalBytes).toBeLessThanOrEqual(limits.maxFileBytes + limits.maxRotatedBytes)

    // 最旧的内容被丢掉了，不是被覆盖成空文件。
    const everything = (await Promise.all(names.map((name) => readFile(join(directory, name), 'utf8')))).join('')
    expect(everything).not.toMatch(/"index":0,/)
    expect(everything).toMatch(/"index":79,/)
  })

  it('keeps a steady-state directory under 20 MiB with the shipped limits', async () => {
    const directory = join(root, 'steady-state')
    const log = createAppLog({ directory, redact: (text) => text })
    const lineBytes = 256 * 1024
    const payload = 'x'.repeat(lineBytes)

    // 25 MiB 的连续写入：足以滚过 5 MiB × 3 的预算好几轮。
    for (let index = 0; index < 100; index++) log.log('info', 'payload', { index, payload })

    const names = await readdir(directory)
    const sizes = await Promise.all(names.map(async (name) => (await stat(join(directory, name))).size))
    const totalBytes = sizes.reduce((total, size) => total + size, 0)
    const rolledBytes = totalBytes - (await stat(log.path)).size

    expect(Math.max(...sizes)).toBeLessThanOrEqual(5 * 1024 * 1024)
    expect(rolledBytes).toBeLessThanOrEqual(15 * 1024 * 1024)
    // 真实峰值：滚动文件 ≤ 15 MiB + 活动文件 ≤ 5 MiB。
    expect(totalBytes).toBeLessThanOrEqual(20 * 1024 * 1024)
  })

  it('refuses to write at all without a redactor', () => {
    expect(() => createAppLog({ directory: join(root, 'unredacted') } as never)).toThrow(
      /requires a redactor/
    )
  })
})
