import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../..')
const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8')
const [dark, light = ''] = css.split(':root[data-theme="light"]')

describe('UI token file', () => {
  it('defines --caution with the one agreed value in both theme blocks', () => {
    expect(dark).toMatch(/--caution:\s*#c48a1a;/)
    expect(light).toMatch(/--caution:\s*#a2691a;/)
  })

  it('defines the three metric sizes in both theme blocks', () => {
    for (const block of [dark, light]) {
      expect(block).toMatch(/--font-metric-sm:\s*24px;/)
      expect(block).toMatch(/--font-metric-md:\s*30px;/)
      expect(block).toMatch(/--font-metric-lg:\s*42px;/)
    }
  })

  it('keeps --warning as an alias of --caution, not a second yellow', () => {
    expect(dark).toMatch(/--warning:\s*var\(--caution\);/)
    expect(light).toMatch(/--warning:\s*var\(--caution\);/)
    expect(css).not.toMatch(/--warning:\s*#/)
  })

  it('has no colour fallback at the call site', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/var\([^)]*,\s*#/)
  })

  /**
   * `--surface-raised` 的对比度**算出来**，不靠眼睛看。
   *
   * 这条判据的来源是封版那天的一句：可算的对比度不要留给眼睛，眼睛只判「这个信号该不该由
   * 底色承担」。所以方向对不对、够不够，一律跑算式——以后谁再动这个 token，红了就知道。
   *
   * 两个条件缺一不可：
   * ① 两套主题都 > 1.1：低于这个数，「浮起」在屏幕上看不出来；
   * ② 必须**比被它替换掉的值大**：`--surface-raised` 曾经是 `--surface-strong` 的别名，
   *    深色下那个值比容器更暗（#191d23 对 #222832 = 1.14），所以选中态读成「陷下去」。
   *    只判 ① 会放过「更暗但对比更高」的值——那是同一个 bug 换个方向。
   */
  it('keeps --surface-raised lighter than its container in both themes, by more than the alias it replaced', () => {
    const luminance = (hex: string): number => {
      const value = hex.replace('#', '')
      const channel = (offset: number): number => {
        const raw = parseInt(value.slice(offset, offset + 2), 16) / 255
        return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
    }
    const contrast = (a: string, b: string): number => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
      return (high + 0.05) / (low + 0.05)
    }
    const hexOf = (block: string, name: string): string => {
      const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)
      if (match?.[1] === undefined) throw new Error(`missing --${name}`)
      return match[1]
    }

    // 容器的两个值住在壳层的 `styles.css` 里，不在这个文件——**这本身是一处该收拢的债**：
    // 判断 `--surface-raised` 够不够，必须同时读两个层。所以这里跨过去读，并把这件事写下来，
    // 而不是在测试里硬编码两个色值——硬编码的色值会在下一次调色时悄悄过期。
    const shell = readFileSync(join(ROOT, 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    const shellDark = shell.slice(shell.indexOf(':root {'), shell.indexOf(':root[data-theme="light"]'))
    const shellLight = shell.slice(shell.indexOf(':root[data-theme="light"]'), shell.indexOf(':root[data-platform='))

    for (const [block, shellBlock] of [
      [dark, shellDark],
      [light, shellLight]
    ] as const) {
      const container = hexOf(shellBlock, 'surface-soft')
      const raised = hexOf(block, 'surface-raised')
      const replaced = hexOf(shellBlock, 'surface-strong')

      // ① 看得出是一层。
      expect(contrast(raised, container)).toBeGreaterThan(1.1)
      // ② 方向必须朝亮，而且比原来那个别名更好——否则就是「更暗但更有对比」的同一个 bug。
      expect(luminance(raised)).toBeGreaterThan(luminance(container))
      expect(contrast(raised, container)).toBeGreaterThan(contrast(replaced, container))
    }
  })
})
