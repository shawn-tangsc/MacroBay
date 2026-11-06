import type { MenuItem } from '@platform/ui/components/menu'

import type { NewsSentimentItemView, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'

export type DrawerSourceOption = { value: string; label: string }

/**
 * 抽屉顶部来源筛选的选项：先是「全部」，再是当前窗口里出现过的来源。
 *
 * 两个来源都要读：配置里可用的来源在当天一条新闻都没有时也该能选，
 * 而只有行里才有的来源（配置删了、记录还在）不该从选项里消失。
 */
export function drawerSourceOptions(
  view: NewsSentimentView | undefined,
  allLabel: string
): DrawerSourceOption[] {
  const seen = new Map<string, string>()
  for (const source of view?.availableSources ?? []) seen.set(source.sourceId, source.sourceName)
  for (const row of view?.items ?? []) if (!seen.has(row.sourceId)) seen.set(row.sourceId, row.sourceName)
  return [{ value: 'all', label: allLabel }, ...[...seen].map(([value, label]) => ({ value, label }))]
}

/**
 * 右键菜单里那一条「翻译 / 重译」：按这一行有没有译文决定措辞。
 *
 * 平台 `MenuItem` 只收键，所以句子仍由本功能的文案表解析——这里只决定键。
 */
export function drawerTranslateMenuItem(input: {
  contextMenuItemId: string | undefined
  translationStates: Readonly<Record<string, string>> | undefined
  rows: readonly Pick<NewsSentimentItemView, 'itemId' | 'bodyTranslationState'>[]
}): MenuItem[] {
  const row = input.contextMenuItemId
    ? input.rows.find((candidate) => candidate.itemId === input.contextMenuItemId)
    : undefined
  // 队列里的状态先于记录里的：正在翻的这一条，菜单要跟着它已经有的译文变。
  const state = input.contextMenuItemId
    ? input.translationStates?.[input.contextMenuItemId] ?? row?.bodyTranslationState
    : undefined
  return [{
    key: 'translate',
    labelKey: state === 'translated' ? 'news.sentiment.retranslate' : 'news.sentiment.translate'
  }]
}
