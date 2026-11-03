import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  createJsonFileStorage,
  quarantineCorruptFile,
  readJsonFileRecovering,
  readJsonFileRecoveringSync,
  recoverJsonArray,
  recoverJsonValue,
  writeJsonFileAtomically
} from './jsonFileStorage'

describe('json file storage', () => {
  it('returns fallback data when the file does not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const storage = createJsonFileStorage(join(directory, 'missing.json'), { value: 'fallback' })

    await expect(storage.read()).resolves.toEqual({ value: 'fallback' })

    await rm(directory, { recursive: true, force: true })
  })

  it('creates parent directories and reads back written data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const storage = createJsonFileStorage(join(directory, 'nested', 'settings.json'), {})

    await storage.write({ value: 'saved' })
    await expect(storage.read()).resolves.toEqual({ value: 'saved' })

    await rm(directory, { recursive: true, force: true })
  })

  it('replaces a longer file without leaving the previous tail behind', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const file = join(directory, 'state.json')
    await writeFile(file, JSON.stringify({ values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }), 'utf8')

    await writeJsonFileAtomically(file, { values: [1] })

    await expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ values: [1] })
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])

    await rm(directory, { recursive: true, force: true })
  })

  it('keeps two concurrent writes in the same process apart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const file = join(directory, 'state.json')
    // 同进程、同一文件、两次并发写：临时名只按 PID 时两者会写同一个 tmp，一个刚 truncate、
    // 另一个写到一半，先 rename 的那个把半成品发布出去——正是「完整文档 + 残片」的来源。
    const first = { values: Array.from({ length: 4000 }, (_, index) => `first-${index}`) }
    const second = { values: Array.from({ length: 4000 }, (_, index) => `second-${index}`) }

    await Promise.all([writeJsonFileAtomically(file, first), writeJsonFileAtomically(file, second)])

    const raw = await readFile(file, 'utf8')
    // 最终文件必须是一份完整文档，且就是其中一次写的全部内容——不是两份混在一起。
    const parsed = JSON.parse(raw) as unknown
    expect(parsed).toEqual(expect.objectContaining({ values: expect.any(Array) }))
    const written = (parsed as { values: string[] }).values
    expect(written.length).toBe(4000)
    expect(written[0] === 'first-0' || written[0] === 'second-0').toBe(true)
    expect(written.every((entry) => entry.startsWith(written[0].split('-')[0]))).toBe(true)
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])

    await rm(directory, { recursive: true, force: true })
  })

  it('recovers the array from a file that has a second fragment after it', async () => {
    const raw = '[\n  {\n    "id": 1\n  }\n]\n\n  }\n]\n'

    expect(recoverJsonArray(raw)).toEqual([{ id: 1 }])
    expect(recoverJsonArray('{ not json')).toBeNull()
  })

  it('keeps a timestamped copy of a corrupt file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const file = join(directory, 'state.json')

    await quarantineCorruptFile(file, '{ broken')

    const copies = (await readdir(directory)).filter((name) => name.startsWith('state.json.corrupt-'))
    expect(copies).toHaveLength(1)
    await expect(readFile(join(directory, copies[0]), 'utf8')).resolves.toBe('{ broken')

    await rm(directory, { recursive: true, force: true })
  })

  it('recovers any document that has a second fragment after it', () => {
    expect(recoverJsonValue('{"a":1}\n\n  }\n]\n')).toEqual({ a: 1 })
    expect(recoverJsonValue('[1,2]\n]')).toEqual([1, 2])
    expect(recoverJsonValue('{ not json')).toBeUndefined()
  })

  it('reads back a torn file, keeps the raw copy and rewrites the clean value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))
    const file = join(directory, 'state.json')
    await writeFile(file, '{"enabled":true}\n\n  }\n]\n', 'utf8')

    await expect(readJsonFileRecovering(file)).resolves.toEqual({ enabled: true })
    await expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ enabled: true })
    expect((await readdir(directory)).filter((name) => name.includes('.corrupt-'))).toHaveLength(1)

    await rm(directory, { recursive: true, force: true })
  })

  it('returns undefined for a missing file and recovers the synchronous read as well', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-storage-'))

    await expect(readJsonFileRecovering(join(directory, 'missing.json'))).resolves.toBeUndefined()
    expect(readJsonFileRecoveringSync(join(directory, 'missing.json'))).toBeUndefined()

    const file = join(directory, 'torn.json')
    await writeFile(file, '[1]\n}', 'utf8')
    expect(readJsonFileRecoveringSync(file)).toEqual([1])

    await rm(directory, { recursive: true, force: true })
  })
})
