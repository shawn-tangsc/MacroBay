import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The standard is only worth having if the next page cannot quietly fork it. These guards read the
 * tree instead of a component, because the drift they catch is *new* code that never imported the
 * standard at all.
 */
const repoRoot = resolve(import.meta.dirname, '../../../..')
const sourceRoots = ['apps/desktop-shell/src/renderer/src', 'products', 'platform']
const standardCss = 'platform/ui/components/loading/loadingState.css'
/**
 * **具名例外**（用户 2026-11-20）：时钟卡里那扇装饰性流光**整圈自转**，8 秒一圈。
 *
 * 它和加载态的转圈不是一回事：加载态是**整块区域被 `loadingState` 替换**，两者不会同屏；
 * 而这张卡在没有加载时也在转。所以不是「谁都能转」的白名单——下面还逐条校验：
 * 这个文件里 `rotate(360deg)` 只能出现在 `@keyframes mi-clock-spin` 里，
 * 而那条 keyframes 只能被 `.mi-clock__orbit` 使用。别处一加 rotate，这条守卫照样红。
 */
const decorativeSpinCss = 'products/market-intelligence/desktop/pages/intelligence/clockCard.css'
const decorativeSpinSelector = '.mi-clock__orbit'
const decorativeSpinKeyframes = 'mi-clock-spin'

function walk(root: string, extensions: readonly string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      found.push(...walk(path, extensions))
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path)
    }
  }
  return found
}

function relative(path: string): string {
  return path.slice(repoRoot.length + 1)
}

const files = sourceRoots.flatMap((root) => walk(resolve(repoRoot, root), ['.ts', '.tsx', '.css']))
const productionFiles = files.filter((path) => !/\.test\.(ts|tsx)$/.test(path))

describe('the loading standard', () => {
  it('owns the app’s only rotation animation, except the named decorative spin', () => {
    const rotating = productionFiles
      .filter((path) => path.endsWith('.css'))
      .filter((path) => /rotate\(\s*360deg\s*\)/.test(readFileSync(path, 'utf8')))
      .map(relative)

    // 只有两处：加载态自己，和时钟卡那条**具名例外**；多一处即红。
    expect(rotating.sort()).toEqual([standardCss, decorativeSpinCss].sort())
  })

  it('keeps the decorative spin confined to its one selector and keyframes', () => {
    // **先剥注释再数**：注释里提到 `rotate(360deg)` 只是说明文字，不是第二条旋转。
    const css = readFileSync(resolve(repoRoot, decorativeSpinCss), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    // ① `rotate(360deg)` 只能出现在那条 keyframes 里（别处出现就是第二条旋转）。
    const rotateSites = [...css.matchAll(/rotate\(\s*360deg\s*\)/gu)].length
    const keyframeBody = new RegExp(`@keyframes ${decorativeSpinKeyframes}\\s*\\{([\\s\\S]*?)\\}\\s*(?:\\n|$)`).exec(css)?.[1] ?? ''
    expect(keyframeBody).not.toBe('')
    expect([...keyframeBody.matchAll(/rotate\(\s*360deg\s*\)/gu)].length).toBe(rotateSites)
    // ② 这条 keyframes 只能被那一个选择器引用。
    const uses = [...css.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/gu)]
      .map((match) => match[1]!.trim())
      .filter((value) => value.includes(decorativeSpinKeyframes))
    expect(uses.length).toBe(1)
    const rule = new RegExp(`\\${decorativeSpinSelector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    expect(rule).toContain(`animation: ${decorativeSpinKeyframes}`)
  })

  it('is the only spinner glyph — no component keeps a static loader icon', () => {
    const offenders = productionFiles
      .filter((path) => path.endsWith('.tsx'))
      .filter((path) => /\b(Loader2|LoaderCircle)\b/.test(readFileSync(path, 'utf8')))
      .map(relative)

    expect(offenders).toEqual([])
  })

  it('is not bypassed by a locally animated ".spin" class', () => {
    const offenders = productionFiles
      .filter((path) => path.endsWith('.css'))
      .filter((path) => /\.spin\b/.test(readFileSync(path, 'utf8')))
      .map(relative)

    expect(offenders).toEqual([])
  })
})
