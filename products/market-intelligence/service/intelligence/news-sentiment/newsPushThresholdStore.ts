import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'

/**
 * 「舆情提醒 · 强度门槛」的配置存储（读者 2026-11-07 提：弱 / 中 / 强，选哪档就是该档以上都推）。
 *
 * 三条规矩，和「日历事件提醒」那份存储同一套：
 * - **读坏了一律回默认值（中）**，不抛：配置文件坏掉不该让设置页打不开；默认「中」正是
 *   这条功能上线以来的行为，所以「读不到」不会变成「悄悄放宽成弱」；
 * - **写只接受三档之一**，非法值保持原值，不静默替换成一个看着合理的档；
 * - **字段清单只在这里**：`StoredShape` 与 `normalize` 是这份文件的全部字段。以后要加字段，
 *   同一笔把它登记进 `StoredShape`、`normalize`、`write` 三处，并补一条
 *   「写 → 换一个新的 store 实例读同一个文件 → 值还在」的用例。
 *   2026-11-07 通知设置那次的教训就是这个：字段没进归一化，写进去读回来就没了，而且不报错。
 */
export const NEWS_PUSH_THRESHOLDS = ['low', 'medium', 'high'] as const satisfies readonly NewsSentimentTierThreshold[]

/** 默认「中」＝这条功能上线以来的行为；实测代价见需求（强约 5 条/天、中约 15 条/天、弱约 50 条/天）。 */
export const DEFAULT_NEWS_PUSH_THRESHOLD: NewsSentimentTierThreshold = 'medium'

export type NewsPushThresholdSettings = Readonly<{
  pushThreshold: NewsSentimentTierThreshold
}>

export type NewsPushThresholdStore = Readonly<{
  read: () => NewsPushThresholdSettings
  write: (patch: Readonly<{ pushThreshold?: unknown }>) => NewsPushThresholdSettings
}>

type StoredShape = Partial<{
  pushThreshold: unknown
}>

export function isNewsPushThreshold(value: unknown): value is NewsSentimentTierThreshold {
  return typeof value === 'string' && (NEWS_PUSH_THRESHOLDS as readonly string[]).includes(value)
}

function normalize(stored: StoredShape): NewsPushThresholdSettings {
  return {
    pushThreshold: isNewsPushThreshold(stored.pushThreshold) ? stored.pushThreshold : DEFAULT_NEWS_PUSH_THRESHOLD
  }
}

export function createNewsPushThresholdStore(filePath: string): NewsPushThresholdStore {
  const read = (): NewsPushThresholdSettings => {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') return normalize({})
      return normalize(parsed as StoredShape)
    } catch {
      // 不存在 / 读坏 / 不是 JSON：都回默认（中），不抛、也不猜。
      return normalize({})
    }
  }

  return {
    read,
    write(patch) {
      const current = read()
      const next: NewsPushThresholdSettings = {
        pushThreshold: isNewsPushThreshold(patch.pushThreshold) ? patch.pushThreshold : current.pushThreshold
      }
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(next), 'utf8')
      return next
    }
  }
}
