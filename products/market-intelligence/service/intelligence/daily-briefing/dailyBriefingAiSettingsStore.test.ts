import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

import {
  createDailyBriefingAiSettingsJsonStorage,
  createDailyBriefingAiSettingsStore
} from './dailyBriefingAiSettingsStore'

const NOW = '2026-11-09T12:00:00.000Z'
const FILENAME = 'daily-briefing-settings.json'

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'brief-ai-settings-'))
}

const settings = Object.freeze({
  editorialEnabled: true,
  providerId: 'provider-1',
  modelId: 'model-1',
  webSearchEnabled: false,
  updatedAt: NOW
})

it('refuses to save over a corrupt settings file and leaves it byte for byte', async () => {
  // 读者设置被默认值覆盖的那条路：解析失败返回 undefined，调用方取默认，下一次保存整份写回。
  // 坏文件在这里只能读失败——保存必须拒绝，原文件逐字节不变，并先留一份 .corrupt-*。
  const dir = await directory()
  const file = join(dir, FILENAME)
  const corrupt = '{"editorialEnabled": tru'
  await writeFile(file, corrupt, 'utf8')
  const store = createDailyBriefingAiSettingsStore(
    createDailyBriefingAiSettingsJsonStorage(file, () => 1_700_000_000_000),
    () => NOW
  )

  await expect(store.save(settings)).rejects.toThrow()

  expect(await readFile(file, 'utf8')).toBe(corrupt)
  const files = await readdir(dir)
  expect(files).toContain(`${FILENAME}.corrupt-1700000000000`)
  expect(await readFile(join(dir, `${FILENAME}.corrupt-1700000000000`), 'utf8')).toBe(corrupt)
})

it('still saves when the file was never written', async () => {
  // 「从没配过」可以用默认、也必须能落下第一次设置；只有「读失败」才拒绝。
  const dir = await directory()
  const file = join(dir, FILENAME)
  const store = createDailyBriefingAiSettingsStore(createDailyBriefingAiSettingsJsonStorage(file), () => NOW)

  const saved = await store.save(settings)

  expect(saved).toEqual(settings)
  expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ providerId: 'provider-1', modelId: 'model-1' })
})

it('fails closed when the corrupt copy itself cannot be kept', async () => {
  // 留档失败时不许再往前走：没有副本就没有「事后能查」的保证，这一笔保存必须失败，原文件不动。
  const dir = await directory()
  const file = join(dir, FILENAME)
  const corrupt = '{"webSearchEnabled": '
  await writeFile(file, corrupt, 'utf8')
  // 把时间戳钉成一个已知值，并在那个位置放一个目录，让 copyFile 一定失败。
  await mkdir(join(dir, `${FILENAME}.corrupt-1700000000001`))
  const store = createDailyBriefingAiSettingsStore(
    createDailyBriefingAiSettingsJsonStorage(file, () => 1_700_000_000_001),
    () => NOW
  )

  await expect(store.save(settings)).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe(corrupt)
})
