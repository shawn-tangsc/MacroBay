import { describe, expect, it } from 'vitest'

import type { StateViewProps } from './StateView'

/**
 * `details` 的正文是**互斥二选一**：`bodyKey`（平台句子）或 `bodyText`（已脱敏原文）。
 *
 * 这条用例在 `.ts` 里，所以 `@ts-expect-error` 是**真被执行**的（tsconfig 的 include 覆盖
 * platform 下的 .ts 文件）——不是只写在注释里的约定。两个同时给意味着「哪一句才是正文」没有答案；
 * 一个都不给意味着渲染一个没有内容的折叠框。
 */
const base = { resolveText: (value: string) => value } as const

describe('StateDetails is exclusive', () => {
  it('accepts exactly one body form and rejects both or neither', () => {
    const byKey: StateViewProps = { ...base, state: 'error', reasonCode: 'unreadable', details: { bodyKey: 'ui.state.error.details' } }
    const byText: StateViewProps = { ...base, state: 'error', reasonCode: 'unreadable', details: { bodyText: 'TypeError: fetch failed' } }

    // @ts-expect-error 两种正文同时给编译不过：正文只能有一种形态。
    const both: StateViewProps = { ...base, state: 'error', reasonCode: 'unreadable', details: { bodyKey: 'ui.state.error.details', bodyText: 'x' } }
    // @ts-expect-error 一个都不给也编译不过：没有正文就没有折叠区。
    const neither: StateViewProps = { ...base, state: 'error', reasonCode: 'unreadable', details: {} }

    expect([byKey, byText, both, neither]).toHaveLength(4)
  })
})
