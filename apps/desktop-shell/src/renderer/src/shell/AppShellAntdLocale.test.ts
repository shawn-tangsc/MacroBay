import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { describe, expect, it } from 'vitest'

import { resolveAntDesignLocale } from './AppShell'

describe('Ant Design shell locale', () => {
  it.each([
    ['zh-CN', zhCN],
    ['en-US', enUS]
  ] as const)('maps %s to its Ant Design locale', (language, expectedLocale) => {
    expect(resolveAntDesignLocale(language)).toBe(expectedLocale)
  })
})
