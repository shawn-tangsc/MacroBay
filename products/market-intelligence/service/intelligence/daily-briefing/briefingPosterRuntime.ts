import { configureBriefingPosterRead } from '@platform/ai/agent-platform/channels/briefingPosterReadRegistry'

import type { DailyBriefingStore } from './dailyBriefingService'
import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { OffscreenCaptureOutcome } from '@platform/desktop/main/window/offscreenCaptureWindow'
import { createDailyBriefingSqliteStore } from './dailyBriefingStore'
import { createBriefingPosterFiles } from './briefingPosterFiles'
import { createBriefingPosterProducer, type BriefingPosterProducer } from './briefingPosterProducer'
import { createBriefingPosterSource, toBriefingPosterRead } from './briefingPosterSource'

/**
 * 简报海报这一整套的装配**一处**：文件目录、海报表（与版次同一个数据库句柄）、
 * 通道侧只读取图入口的注册、以及出图生产者。
 *
 * 为什么收成一个入口：这不是「顺手接线」——少注册一处，链路就静默退回只发正文，而且不报错；
 * 分开写在装配根里，下一个人改一半也不会立刻红。这里返回 `renderPoster` 给发布路径，
 * 同时把取图入口注册好（未注入截图能力时**不注册**：没有生产者就不该有读图口）。
 */
export function createBriefingPosterRuntime(input: Readonly<{
  databasePath: string
  posterDirectory: string
  capture?: (target: Readonly<{
    product: string
    entry: string
    params: Readonly<Record<string, string>>
  }>) => Promise<OffscreenCaptureOutcome>
  productId?: string
  entryId?: string
}>): Readonly<{ store: DailyBriefingStore; renderPoster?: BriefingPosterProducer['render'] }> {
  const posterFiles = createBriefingPosterFiles({ directory: input.posterDirectory })
  const store = createDailyBriefingSqliteStore(input.databasePath, { posterFiles })
  const posters = store.posters
  if (posters === undefined) return { store }

  // 取图口与生产者成对出现：没有生产者却注册了读图口，等于承诺一张永远不会存在的图。
  if (input.capture === undefined) return { store }

  const capture = input.capture
  const product = input.productId ?? 'market-intelligence'
  const entry = input.entryId ?? 'briefing-poster'
  const renderPoster = createBriefingPosterProducer({
    capture: (target) => capture({
      product,
      entry,
      params: { date: target.date, periodId: target.periodId, locale: target.locale as DailyBriefingLocale }
    }),
    files: posterFiles,
    store: posters
  }).render

  configureBriefingPosterRead(toBriefingPosterRead(createBriefingPosterSource({ store: posters, files: posterFiles })))
  return { store, renderPoster }
}
