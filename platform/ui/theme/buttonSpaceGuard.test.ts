import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Owner: platform/ui/theme（**「两个汉字之间不加空格」只关一次**）。
 *
 * 主窗与分离窗的 `ConfigProvider` 都读 `WINDOW_ANTD_BUTTON_CONFIG`，所以产品与外壳代码里
 * **不该再出现逐按钮的 `autoInsertSpace`**：那等于「一处全局 + N 处覆盖」，每换一批按钮就多一份，
 * 而且删的时候永远有人忘了删——「收 起」这种错字就是这么回来的。
 *
 * 断言：`platform/ui/theme` 之外，源码里不允许出现 `autoInsertSpace`（断言文件自己不参与扫描）。
 */

const ROOT = process.cwd()
const SOURCE_ROOTS = ['apps/desktop-shell/src', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage'])
/** 唯一允许出现它的模块：全局配置本身。 */
const OWNER = 'platform/ui/theme/windowAntdTheme.ts'

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) {
      collectSourceFiles(absolute, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(relative(ROOT, absolute).replace(/\\/g, '/'))
  }
  return out
}

describe('antd 中文按钮不加空格，只关一次', () => {
  it('autoInsertSpace 只出现在全局配置里，产品与外壳一个都没有', () => {
    const offenders = SOURCE_ROOTS
      .flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
      .filter((file) => file !== OWNER && readFileSync(resolve(ROOT, file), 'utf8').includes('autoInsertSpace'))

    expect(offenders).toEqual([])
  })

  it('两个 ConfigProvider 都引用同一份配置', () => {
    const theme = readFileSync(resolve(ROOT, OWNER), 'utf8')
    expect(theme).toContain('export const WINDOW_ANTD_BUTTON_CONFIG')

    for (const provider of [
      'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx',
      'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceWindowTheme.tsx'
    ]) {
      const source = readFileSync(resolve(ROOT, provider), 'utf8')
      expect(source, `${provider} 必须读同一份按钮配置`).toContain('WINDOW_ANTD_BUTTON_CONFIG')
      expect(source, `${provider} 必须读同一份波纹配置`).toContain('WINDOW_ANTD_WAVE_CONFIG')
    }
  })
})
