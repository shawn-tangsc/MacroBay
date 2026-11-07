import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createNewsPushThresholdStore } from './newsPushThresholdStore'

/**
 * 「强度门槛」的存储判定。
 *
 * 第二条用例是**今天那条规矩的第一次真正使用**（2026-11-07 通知设置「勾了存不住」）：
 * 写进去之后必须**换一个新的 store 实例读同一个文件**，值还在。在同一个实例里读回来证明的是
 * 内存，不是落盘——那次 bug 的用例就是这么漏的。
 */
const dirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'news-push-threshold-'))
  dirs.push(dir)
  return join(dir, 'intelligence-news-push-threshold.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('news push threshold store', () => {
  it('defaults to Medium when the file is missing, unreadable, or holds an unknown tier', () => {
    expect(createNewsPushThresholdStore(tempFile()).read()).toEqual({ pushThreshold: 'medium' })

    const broken = tempFile()
    writeFileSync(broken, 'not json', 'utf8')
    expect(createNewsPushThresholdStore(broken).read()).toEqual({ pushThreshold: 'medium' })

    const unknown = tempFile()
    writeFileSync(unknown, JSON.stringify({ pushThreshold: 'extreme' }), 'utf8')
    expect(createNewsPushThresholdStore(unknown).read()).toEqual({ pushThreshold: 'medium' })
  })

  it('survives a fresh store reading the same file', () => {
    const file = tempFile()
    createNewsPushThresholdStore(file).write({ pushThreshold: 'high' })

    // 关键：**换一个实例**读同一个文件。同一实例读回来测的是内存，不是落盘。
    expect(createNewsPushThresholdStore(file).read()).toEqual({ pushThreshold: 'high' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ pushThreshold: 'high' })
  })

  it('keeps the previous tier when handed something that is not one of the three', () => {
    const file = tempFile()
    const store = createNewsPushThresholdStore(file)
    store.write({ pushThreshold: 'low' })

    expect(store.write({ pushThreshold: 'loud' })).toEqual({ pushThreshold: 'low' })
    expect(store.write({ pushThreshold: 3 }).pushThreshold).toBe('low')
    expect(createNewsPushThresholdStore(file).read().pushThreshold).toBe('low')
  })

  it('can go back down to Weak — the three tiers are all writable, not just the stricter ones', () => {
    const file = tempFile()
    const store = createNewsPushThresholdStore(file)
    store.write({ pushThreshold: 'high' })
    expect(store.write({ pushThreshold: 'low' }).pushThreshold).toBe('low')
    expect(createNewsPushThresholdStore(file).read().pushThreshold).toBe('low')
  })
})
