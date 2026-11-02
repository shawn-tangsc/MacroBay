// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { Tooltip } from '@platform/ui/components/tooltip'

import type { AgentTooltipKey } from '../agentTooltipText'

/**
 * 键在**编译期**被锁住的那一半契约。
 *
 * 守卫只能校验写死在调用点的字面量：键放进常量、包一层函数，正则就看不见了。这里用
 * `@ts-expect-error` 把另一半钉住——解析器的参数是一组键联合时，`Tooltip` 的 `labelKey`
 * 只能取这组键，写错一处 `tsc` 就红。断言不靠运行时，`expect` 只是让这两个元素被真正构造一次。
 */
const resolveText = (key: AgentTooltipKey): string => key

describe('Tooltip labelKey typing', () => {
  it('accepts a key inside the resolver union and rejects one outside it', () => {
    const inside = (
      <Tooltip labelKey="messages.navigate-top" resolveText={resolveText}>
        <button type="button">top</button>
      </Tooltip>
    )
    expect(inside).toBeTruthy()

    // @ts-expect-error 闭集之外的键必须编译不过，这是类型接管传参的唯一证据
    const outside = (
      <Tooltip labelKey="messages.navigate-sideways" resolveText={resolveText}>
        <button type="button">sideways</button>
      </Tooltip>
    )
    expect(outside).toBeTruthy()
  })
})
