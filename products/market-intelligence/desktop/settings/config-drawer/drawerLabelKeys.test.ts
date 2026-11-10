/**
 * 抽屉的每一行都必须有一个**真的存在**的文案键。
 *
 * 为什么要有这条：静态抽屉交付时，行标签在界面上显示成了 `configDrawer.rows.switch`
 * 这种键名——行清单写的是 `rows.switch`，文案表里叫 `rows.analysisSwitch`，两边对不上，
 * 而当时的用例只断言「行渲染出来了」，Assert(i18n) 一条都没查。用户看到的是内部键。
 *
 * 判据：`DRAWER_PREVIEW_SCREENS` 里每个 `labelKey`（凡以 `configDrawer.` 开头的）
 * 必须在 `productText['zh-CN']` 与 `['en-US']` 的 `configDrawer` 下各有一条非空字符串；
 * 用到的 `EXISTING_LABEL_KEYS` 同样要能解析到。缺一个即红，并点名是哪一屏哪一行。
 */
import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { DRAWER_PREVIEW_SCREENS, EXISTING_LABEL_KEYS } from './drawerPreviewRows'

type Dict = Record<string, unknown>

function lookup(root: Dict, path: string): unknown {
  let node: unknown = root
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Dict)[part]
  }
  return node
}

const languages = ['zh-CN', 'en-US'] as const

function configDrawerOf(language: (typeof languages)[number]): Dict {
  return productText[language].pages.intelligence.portal.dashboard.configDrawer as unknown as Dict
}

describe('the drawer rows resolve to real copy', () => {
  it('every configDrawer label key exists in both languages', () => {
    const missing: string[] = []
    for (const screen of DRAWER_PREVIEW_SCREENS) {
      for (const group of screen.groups) {
        for (const row of group.rows) {
          if (!row.labelKey.startsWith('configDrawer.')) continue
          const path = row.labelKey.slice('configDrawer.'.length)
          for (const language of languages) {
            const value = lookup(configDrawerOf(language), path)
            if (typeof value !== 'string' || value.trim() === '') {
              missing.push(`${screen.menu} / ${row.key}: ${row.labelKey} (${language})`)
            }
          }
        }
      }
    }
    expect(missing, `抽屉里有行找不到文案（会渲染成键名）：\n${missing.join('\n')}`).toEqual([])
  })

  it('every existing settings label key the drawer reuses still resolves', () => {
    const missing: string[] = []
    for (const [name, path] of Object.entries(EXISTING_LABEL_KEYS)) {
      for (const language of languages) {
        const value = lookup(productText[language] as unknown as Dict, path)
        if (typeof value !== 'string' || value.trim() === '') missing.push(`${name}: ${path} (${language})`)
      }
    }
    expect(missing, `复用的设置文案键找不到：\n${missing.join('\n')}`).toEqual([])
  })

  it('no row label is itself a raw key', () => {
    const raw = DRAWER_PREVIEW_SCREENS.flatMap((screen) =>
      screen.groups.flatMap((group) => group.rows.map((row) => row.labelKey))
    ).filter((key) => /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]*$/.test(key) && !key.startsWith('settings.') && !key.startsWith('configDrawer.'))
    expect(raw, `行标签看起来是键名而不是键路径：${raw.join(', ')}`).toEqual([])
  })
})
