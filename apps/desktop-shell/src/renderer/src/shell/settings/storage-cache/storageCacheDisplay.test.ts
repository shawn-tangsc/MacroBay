import { describe, expect, it } from 'vitest'

import { CACHE_ERROR_CODES } from '@platform/storage/cache-governance/cacheContracts'
import {
  dedupeWarnings,
  formatBytes,
  formatCacheErrorReason,
  formatInspectionStatus,
  toInspectionDisplayStatus,
  formatRelativeTime,
  formatSensitivity,
  getStorageCacheLabels
} from './storageCacheDisplay'
describe('storageCacheDisplay', () => {
  it('formats byte sizes with a fallback for missing inspections', () => {
    expect(formatBytes(undefined, 'None')).toBe('None')
    expect(formatBytes(512, 'None')).toBe('512 B')
    expect(formatBytes(1536, 'None')).toBe('1.5 KB')
    expect(formatBytes(2 * 1024 * 1024, 'None')).toBe('2.0 MB')
  })

  it('renders relative timestamps and falls back to the raw value when unparsable', () => {
    const now = Date.parse('2026-10-23T02:00:00.000Z')

    expect(formatRelativeTime('2026-10-23T01:57:00.000Z', 'en-US', now)).toBe('3 minutes ago')
    expect(formatRelativeTime('2026-10-23T01:00:00.000Z', 'zh-CN', now)).toBe('1小时前')
    expect(formatRelativeTime('not-a-date', 'en-US', now)).toBe('not-a-date')
    expect(formatRelativeTime(undefined, 'en-US', now)).toBe('')
  })

  it('deduplicates repeated warnings so one notice is shown once', () => {
    expect(dedupeWarnings(['Same warning', ' Same warning ', 'Second']) ).toEqual(['Same warning', 'Second'])
    expect(dedupeWarnings(['   ', ''])).toEqual([])
  })

  it('maps inspection and sensitivity states through i18n', () => {
    const labels = getStorageCacheLabels('en-US')

    expect(formatInspectionStatus(undefined, labels)).toBe(labels.neverInspected)
    // 四个展示值各有一句，且「还没有数据」与「巡检结果为空」不是同一句。
    expect(toInspectionDisplayStatus(undefined)).toBe('never-inspected')
    expect(toInspectionDisplayStatus('empty')).toBe('empty')
    const displayLabels = [
      formatInspectionStatus('ready', labels),
      formatInspectionStatus('empty', labels),
      formatInspectionStatus('inspection_failed', labels),
      formatInspectionStatus(undefined, labels)
    ]
    expect(displayLabels.every((label) => label.trim().length > 0)).toBe(true)
    expect(displayLabels[1]).not.toBe(displayLabels[3])
    expect(formatInspectionStatus('inspection_failed', labels)).toBe(labels.statusInspectionFailed)
    expect(formatSensitivity('contains-user-content', labels)).toBe(labels.sensitivityContainsUserContent)
  })

  it('maps every cache error code to its own sentence and never to a blank', () => {
    const zh = getStorageCacheLabels('zh-CN')
    const en = getStorageCacheLabels('en-US')

    // 闭集逐条：每一条原因码都有一句，且彼此不同（不许两条落到同一句泛泛的「失败」）。
    const zhReasons = CACHE_ERROR_CODES.map((code) => formatCacheErrorReason(code, zh))
    expect(zhReasons.every((text) => text.trim().length > 0)).toBe(true)
    expect(new Set(zhReasons).size).toBe(CACHE_ERROR_CODES.length)
    expect(CACHE_ERROR_CODES.map((code) => formatCacheErrorReason(code, en)).every((text) => text.trim().length > 0)).toBe(
      true
    )

    // 没拿到原因码、以及闭集外的值：都是「拿不到」，说清没拿到，不编一个原因。
    expect(formatCacheErrorReason(undefined, zh)).toBe(zh.errorReasonUnavailable)
    expect(formatCacheErrorReason('cache_unknown_from_provider' as never, zh)).toBe(zh.errorReasonUnavailable)
    expect(zh.errorReasonUnavailable).not.toContain('没有原因')
  })
})
