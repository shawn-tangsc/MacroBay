import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AppShell assistant navigation', () => {
  it('forwards assistant topic navigation detail into AssistantPage', () => {
    // 2026-11-09：外壳拆成 AppShell + AppShellView。**逐文件断言，不拼成一个字符串**：
    // 拼接会把文件边界抹掉——`detail?.assistant` 在 A 文件尾部、`setAssistantOpenRequest` 在
    // B 文件开头也能命中，那等于守卫失效。
    const shellRoot = resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell')
    const read = (file: string): string => readFileSync(resolve(shellRoot, file), 'utf8')
    const shell = read('AppShell.tsx')
    const view = read('AppShellView.tsx')

    // 事件入口与状态写入：同一处代码，两半必须在同一个文件里相邻。
    expect(shell).toMatch(/detail\?\.assistant[\s\S]*setAssistantOpenRequest\(detail\.assistant\)/)
    // 类型与被渲染的页面：都在视图文件里，且页面真的收下这个状态。
    expect(view).toContain('type AssistantOpenRequest')
    expect(view).toMatch(/<AssistantPage[\s\S]*openRequest=\{assistantOpenRequest\}/)
  })
})
