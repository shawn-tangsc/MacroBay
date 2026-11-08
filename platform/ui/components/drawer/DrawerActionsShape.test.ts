import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import type { DrawerProps } from './Drawer'

/**
 * 一个头里只能有**一个**动作（`ui-conventions.md`「Header action slots」）。
 *
 * 类型上把 `actions` 收成单个 `ReactElement`，所以「传数组」编译不过。这里用 `.ts` 写，
 * `@ts-expect-error` 才是真被检查的（tsconfig 覆盖 platform 下的 .ts 文件）。
 *
 * **拦到哪儿、没拦到哪儿**（组件注释里同样写着）：数组拦得住；`<>{a}{b}</>` 这种一个 Fragment
 * 里塞两个，类型看不出来——那一条靠评审与调用点用例，不为此造一套重型机制。
 */
const common = {
  mode: 'modal',
  open: true,
  onClose: () => undefined,
  size: 'narrow',
  titleKey: 'ui.test.title',
  resolveText: (value: string) => value,
  children: null
} as const

describe('Drawer actions is a single element', () => {
  it('accepts one element and rejects an array of them', () => {
    const one: DrawerProps = { ...common, actions: createElement('button', null, 'send') }
    // @ts-expect-error 一个头里两个动作意味着这一页没有动作层级：第二个该进正文。
    const two: DrawerProps = { ...common, actions: [createElement('button'), createElement('button')] }

    expect([one, two]).toHaveLength(2)
  })
})
