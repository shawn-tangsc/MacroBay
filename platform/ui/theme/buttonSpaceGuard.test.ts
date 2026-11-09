import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { Button, ConfigProvider } from 'antd'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WINDOW_ANTD_BUTTON_CONFIG } from './windowAntdTheme'

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

  it('全局配置真的生效：包上时两个汉字贴在一起，不包时才插入空格', () => {
    // 上面两条只证明「只有一处写了 autoInsertSpace」，证明不了那一处**有效**：
    // 常量被改成 true、antd 换属性名、ConfigProvider 漏传 button，三种坏法都不会让它们变红，
    // 而全站中文按钮会长出「收 起」。所以这里断言**渲染出来的文字**，不是属性值。
    const label = (html: string): string => /<span[^>]*>([^<]*)<\/span>/.exec(html)?.[1] ?? ''

    const wrapped = renderToStaticMarkup(
      createElement(ConfigProvider, { button: WINDOW_ANTD_BUTTON_CONFIG }, createElement(Button, null, '查看'))
    )
    expect(label(wrapped)).toBe('查看')
    expect(label(wrapped)).not.toContain(' ')

    // 反向夹具：不包配置时确实会插入空格——否则这条用例可能只是「两边都没空格也算过」。
    const bare = renderToStaticMarkup(createElement(Button, null, '查看'))
    expect(label(bare)).toBe('查 看')

    // 显式打开也一样，证明上面那条的差异来自配置，而不是按钮本身不长这样。
    const forced = renderToStaticMarkup(
      createElement(ConfigProvider, { button: { autoInsertSpace: true } }, createElement(Button, null, '查看'))
    )
    expect(label(forced)).toBe('查 看')
  })

  it('两个 ConfigProvider 都引用同一份配置', () => {
    const theme = readFileSync(resolve(ROOT, OWNER), 'utf8')
    expect(theme).toContain('export const WINDOW_ANTD_BUTTON_CONFIG')

    // 2026-11-09：主窗视图连同它的 `ConfigProvider` 从 `AppShell.tsx` 搬到 `AppShellView.tsx`
    // （只搬运、DOM 与接线未变）。判据不变、不断言放宽，只把读取的文件指向新位置。
    // 事实核对：两处都从 `@platform/ui/theme/windowAntdTheme` 导入同一对常量
    // （`WINDOW_ANTD_BUTTON_CONFIG` / `WINDOW_ANTD_WAVE_CONFIG`），不存在第二份配置。
    for (const provider of [
      'apps/desktop-shell/src/renderer/src/shell/AppShellView.tsx',
      'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceWindowTheme.tsx'
    ]) {
      const source = readFileSync(resolve(ROOT, provider), 'utf8')
      // 断到 prop 上，不是断到 import：`toContain('WINDOW_ANTD_BUTTON_CONFIG')` 光靠 import 行就满足，
      // 把 `button={…}` 从 JSX 里删掉它照样绿——那不是「引用了」，只是「提到过」。
      expect(source, `${provider} 必须从单源导入按钮配置`).toMatch(
        /import \{[^}]*WINDOW_ANTD_BUTTON_CONFIG[^}]*WINDOW_ANTD_WAVE_CONFIG[^}]*\} from '@platform\/ui\/theme\/windowAntdTheme'/u
      )
      expect(source, `${provider} 必须把按钮配置传给 ConfigProvider`).toMatch(/button=\{WINDOW_ANTD_BUTTON_CONFIG\}/u)
      expect(source, `${provider} 必须把波纹配置传给 ConfigProvider`).toMatch(/wave=\{WINDOW_ANTD_WAVE_CONFIG\}/u)
    }
  })
})
