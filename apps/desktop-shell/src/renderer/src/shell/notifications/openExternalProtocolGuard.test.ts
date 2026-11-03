import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 渲染层递给 `openExternal` 的地址必须是 http(s)。
 *
 * 主进程的出口只放行 http(s)（`windowIpc.ts` 的 `shellOpenExternal`），别的 scheme 会**抛错**：
 * 界面上那个按钮于是变成「点了没反应」，而且只要条件不可达就没人发现——今天正好有一次
 * （`x-apple.systempreferences:` 那条链，`denied` 不可达所以按钮从不显示）。
 *
 * 所以这条守的是**调用点**，不是主进程：读不到的地址不许写进代码里等着哪天可达。
 */
const RENDERER_ROOT = resolve(__dirname, '../..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(full)
  }
  return out
}

/** 抽出来只为证明它会红：同一个判据既扫全树，也能对一段源码单独判。 */
function offendingTargets(source: string): string[] {
  const offences: string[] = []
  for (const match of source.matchAll(/openExternal\(\s*'([^']+)'/g)) {
    const url = match[1]!
    if (!url.startsWith('http://') && !url.startsWith('https://')) offences.push(url)
  }
  return offences
}

describe('openExternal call sites', () => {
  it('flags a non-http target — the judgement itself can fail', () => {
    // 反例：今天删掉的那条链，喂给同一个判据必须被抓住。
    expect(offendingTargets("void window.platform.app.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')"))
      .toEqual(['x-apple.systempreferences:com.apple.Notifications-Settings.extension'])
    expect(offendingTargets("openExternal('https://example.test')")).toEqual([])
  })

  it('only hands http(s) URLs to the shell', () => {
    const offences: string[] = []
    let scanned = 0
    for (const file of sourceFiles(RENDERER_ROOT)) {
      const source = readFileSync(file, 'utf8')
      const found = offendingTargets(source)
      scanned += source.match(/openExternal\(/g)?.length ?? 0
      for (const url of found) offences.push(`${relative(RENDERER_ROOT, file)} → ${url}`)
    }
    // 扫描面为 0 时这条也会绿，那是假绿：这里钉住「确实扫到了调用点」。
    expect(scanned).toBeGreaterThan(0)
    expect(offences, '这些地址会被主进程白名单拒绝，按钮点了会抛错').toEqual([])
  })
})
