import { describe, expect, it } from 'vitest'

import { LEGACY_ALLOWLIST, RENDER_BRANCH_ALLOWLIST, offendersIn, undefinedAsErrorIn } from './check-async-initial-state.mts'

/**
 * 这条守卫自己也要有守卫。
 *
 * 两件事：① 三种「初值是终态」的写法必须真被认出来（否则它只是一条永远通过的用例）；
 * ② **白名单条数不许变多**——名单一旦能加，它三天后就是新的藏身处。
 */
describe('async initial state guard', () => {
  it('catches a settled literal, a settled object and a hand-written AsyncState literal', () => {
    const literal = offendersIn(`a.tsx`, `const [view, setView] = useState<'loading' | 'error'>('error')`)
    const object = offendersIn(`b.tsx`, `const [state, setState] = useState<View>({ state: 'unavailable' })`)
    const asyncLiteral = offendersIn(`c.tsx`, `const [s, setS] = useState<AsyncState<Row[]>>({ status: 'loading' })`)

    expect(literal).toHaveLength(1)
    expect(literal[0]?.line).toBe(1)
    expect(object).toHaveLength(1)
    expect(asyncLiteral).toHaveLength(1)
    // 命中的那一段要能读出来：报错里只给行号，接的人还得自己回去找。
    expect(literal[0]?.value).toContain(`'error'`)
  })

  it('leaves ordinary state alone — booleans, null and a loading first frame are not the bug', () => {
    const fine = [
      `const [open, setOpen] = useState(false)`,
      `const [row, setRow] = useState<Row | null>(null)`,
      `const [s, setS] = useState<View>({ state: 'loading' })`,
      `const [s, setS] = useState<AsyncState<Row[]>>(initialAsyncState)`
    ].flatMap((code, index) => offendersIn(`ok-${index}.tsx`, code))

    expect(fine).toEqual([])
  })

  /**
   * 第二种形状的红/绿 fixture（2026-11-07）：把「还没读到」画成「读不到」。
   *
   * 红的那条是**事故形状本身**：可选值 `=== undefined` 直接渲染错误态，而这一路没有 loading 档。
   * 绿的两条各去掉一个条件（有 loading 档 / 不是终态渲染），证明判据抓的是形状而不是文件名。
   */
  it('RED fixture: an optional value rendered as an error state with no loading state is caught', () => {
    const red = [
      `import { StateView } from '@platform/ui/components/state'`,
      `function Detail() {`,
      `  const [value] = useState<View>()`,
      `  if (value === undefined) {`,
      `    return <StateView state="error" reasonCode="unreadable" />`,
      `  }`,
      `  return <div />`,
      `}`
    ].join('\n')

    const found = undefinedAsErrorIn('red.tsx', red)
    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(4)
  })

  it('GREEN fixture: the same branch with a loading state present is not the bug', () => {
    const green = [
      `import { StateView } from '@platform/ui/components/state'`,
      `function Detail() {`,
      `  const [value, status] = useState<View>()`,
      `  if (status === 'loading') return <p>loading</p>`,
      `  if (value === undefined) {`,
      `    return <StateView state="error" reasonCode="unreadable" />`,
      `  }`,
      `  return <div />`,
      `}`
    ].join('\n')

    expect(undefinedAsErrorIn('green.tsx', green, { siblingText: `type S = 'loading' | 'ready'` })).toEqual([])
  })

  it('GREEN fixture: an undefined check that does not render a terminal state is left alone', () => {
    const code = [
      `function Detail() {`,
      `  const [value] = useState<View>()`,
      `  if (value === undefined) return null`,
      `  return <div />`
    ].join('\n')

    expect(undefinedAsErrorIn('ok.tsx', code)).toEqual([])
  })

  it('keeps the legacy allowlist from growing', () => {
    // 名单当前为空。谁要加，先改这条常量并说明理由——那一刻就是评审点。
    const ALLOWLIST_SIZE_CEILING = 0

    expect(Object.keys(LEGACY_ALLOWLIST).length).toBeLessThanOrEqual(ALLOWLIST_SIZE_CEILING)
    // 渲染分支白名单同样只减不增；现在为空。
    expect(Object.keys(RENDER_BRANCH_ALLOWLIST).length).toBeLessThanOrEqual(0)
    for (const count of Object.values(LEGACY_ALLOWLIST)) expect(count).toBeGreaterThan(0)
  })
})
