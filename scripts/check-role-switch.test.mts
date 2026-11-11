import { describe, expect, it } from 'vitest'

import { roleSwitchLines } from './check-role-switch.mts'

/**
 * 断的是**扫描器本身**（输入字符串 → 命中行），不依赖仓库里恰好有哪个文件。
 *
 * 背景：`ModelServiceModelDrawer.tsx` 记了一笔假欠账，原因是**注释**里带着这串字面量被算成手写开关。
 * 修法是扫描前剥注释；这条修法必须有常驻证据，而不是一次性探针（探针删了，证据就没了）。
 */
describe('role="switch" scanner', () => {
  it('does not count the attribute when it only appears in comments', () => {
    const source = [
      '// 不要手写 role="switch"，请用平台 Switch',
      '/* 也不许：role="switch" */',
      'export const X = () => null'
    ].join('\n')
    expect(roleSwitchLines(source)).toEqual([])
  })

  it('counts the attribute when it is in code, on the line it appears', () => {
    const source = [
      '// 这里提到 role="switch" 只是注释',
      'export const X = () => <span role="switch" aria-checked="true" />'
    ].join('\n')
    expect(roleSwitchLines(source)).toEqual([2])
  })
})
