/**
 * Owner: apps/desktop-shell renderer / shell/navigation。
 * 判据来源：`docs-private/10-development/home-menu-contract.md` §4（四条规则）与 §6（三条守卫）。
 *
 * 这一层只验「菜单 → 菜单键」。壳层把 `null` 映射成兜底常量那一句不在本文件里断言它的**结果**，
 * 而是断言两层分开：`resolveHomeMenuKey([], []) === null`（这一层是判据），壳层才把它变成落点。
 * 只断「最终等于兜底常量」的用例是假的——一个永远返回常量的实现也能过。
 */
import { describe, expect, it } from 'vitest'

import { resolveHomeMenuKey, toProductHomeMenuCandidate, type HomeMenuCandidate } from './homeMenuKey'

/** 内置三页：没有 `order`、没有 `home` —— 与 `builtInWorkspacePages` 今天的形状一致。 */
const builtIns: readonly HomeMenuCandidate[] = [
  { menuKey: 'assistants' },
  { menuKey: 'agents' },
  { menuKey: 'settings' }
]

const homeCandidate = toProductHomeMenuCandidate({
  routePath: '/sample-product/home',
  order: 10,
  home: true
})
const otherCandidate = toProductHomeMenuCandidate({ routePath: '/other/overview', order: 20 })

describe('默认首页解析（口径 A 的落点）', () => {
  it('声明了 home 就返回它 —— 反向判据，防止「永远返回兜底值」的实现混过去', () => {
    const resolved = resolveHomeMenuKey(builtIns, [otherCandidate, homeCandidate])

    // 反向断言：不是 null、也不是菜单顺序里的第一项（否则「有声明」与「没声明」看不出区别）。
    expect(resolved).toBe('/sample-product/home')
    expect(resolved).not.toBe(builtIns[0]!.menuKey)
    expect(resolved).not.toBe(otherCandidate.menuKey)
  })

  it('home 胜出与 order 无关：order 更小的非 home 项不许顶替它', () => {
    const earlier = toProductHomeMenuCandidate({ routePath: '/other/earlier', order: 1 })

    expect(resolveHomeMenuKey(builtIns, [earlier, homeCandidate])).toBe('/sample-product/home')
  })

  it('零处声明 ⇒ 菜单 order 第一项（输入故意乱序，结果不能等于「数组第一个」）', () => {
    const later = toProductHomeMenuCandidate({ routePath: '/other/later', order: 30 })
    const first = toProductHomeMenuCandidate({ routePath: '/other/first', order: 10 })

    const resolved = resolveHomeMenuKey(builtIns, [later, first])

    expect(resolved).toBe('/other/first')
    expect(resolved).not.toBe(later.menuKey)
  })

  it('菜单一页都没有 ⇒ null（判据断在这一层，不是断最终常量）', () => {
    const resolved = resolveHomeMenuKey([], [])

    expect(resolved).toBeNull()
    // 壳层那一句落点：`resolveHomeMenuKey(...) ?? 'assistants'`。
    // 这里把映射本身也钉住，否则「null 之后落到哪」没有任何用例。
    expect(resolved ?? 'assistants').toBe('assistants')
  })

  it('声明 home 的产品不在当前构建里 ⇒ 它的 home 随之消失，退回 order 第一项（守卫 §6-②）', () => {
    // 装配后的菜单里没有情报页：它的 home 不可能「指向一个不存在的页」——结构上就不存在这个状态。
    const surviving = toProductHomeMenuCandidate({ routePath: '/other/overview', order: 20 })

    expect(resolveHomeMenuKey(builtIns, [surviving])).toBe('/other/overview')
  })

  it('内置页声明 home 也生效（同一个字段对两类菜单项一视同仁）', () => {
    const withBuiltInHome: readonly HomeMenuCandidate[] = [
      { menuKey: 'assistants' },
      { menuKey: 'agents', home: true }
    ]

    expect(resolveHomeMenuKey(withBuiltInHome, [homeCandidate])).toBe('agents')
  })

  it('两处声明是错误状态（守卫另有红用例），解析器仍要给出确定答案而不是随机或 null', () => {
    const secondHome = toProductHomeMenuCandidate({ routePath: '/other/second', order: 20, home: true })

    expect(resolveHomeMenuKey(builtIns, [homeCandidate, secondHome])).toBe('/sample-product/home')
    expect(resolveHomeMenuKey(builtIns, [secondHome, homeCandidate])).toBe('/sample-product/home')
  })

  it('未声明 home 的候选里不出现 home 键（不是 false），否则「没声明」与「声明了别的页」分不清', () => {
    expect(otherCandidate).not.toHaveProperty('home')
    expect(homeCandidate).toHaveProperty('home', true)
  })
})
