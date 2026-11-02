import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const mainDir = resolve(__dirname, '..')
const appSource = readFileSync(join(mainDir, 'app.ts'), 'utf8')

describe('composition call site', () => {
  it('runs the composition exactly once, after the userData override', () => {
    // 唯一调用点：读应用名/数据目录的构造不许放模块体，只能由接缝执行之后调用一次。
    const callSites = appSource.match(/createPlatformCore\(\{/g) ?? []
    expect(callSites).toHaveLength(1)
    expect(appSource.indexOf("app.setPath('userData'")).toBeGreaterThan(-1)
    expect(appSource.indexOf("app.setPath('userData'")).toBeLessThan(appSource.indexOf('createPlatformCore({'))
    expect(appSource.indexOf("app.setName(")).toBeLessThan(appSource.indexOf('createPlatformCore({'))
  })

  it('keeps app-level facts out of the composition modules', () => {
    const offenders: string[] = []
    for (const name of readdirSync(__dirname)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
      const source = readFileSync(join(__dirname, name), 'utf8')
      if (/app\.getPath|app\.getName|app\.isPackaged/.test(source)) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })
})
