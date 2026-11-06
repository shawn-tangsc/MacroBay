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

  it('calls the five slice factories once each, in dependency order, after the seam', () => {
    const callSites = {
      platformCore: 'createPlatformCore({',
      repositories: 'createRepositories({',
      agentRuntime: 'createAgentRuntime({',
      channelsAndJobs: 'createChannelsAndJobs({',
      assistantsAndRuntimes: 'createAssistantsAndRuntimes({'
    } as const
    const indexes = Object.fromEntries(
      Object.entries(callSites).map(([name, marker]) => {
        const matches = appSource.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []
        expect(matches, `${name} must be called exactly once`).toHaveLength(1)
        return [name, appSource.indexOf(marker)]
      })
    ) as Record<keyof typeof callSites, number>
    // 接缝之后：应用名与 userData 先定，再建任何会读路径的东西。
    const seam = appSource.indexOf("app.setPath('userData'")
    expect(seam).toBeGreaterThan(-1)
    for (const [name, index] of Object.entries(indexes)) {
      expect(index, `${name} must run after the userData seam`).toBeGreaterThan(seam)
    }
    // 依赖方向：后一片可以拿先一片的产出，反过来不行。
    const order: (keyof typeof callSites)[] = ['platformCore', 'repositories', 'agentRuntime', 'channelsAndJobs', 'assistantsAndRuntimes']
    for (let i = 1; i < order.length; i += 1) {
      expect(indexes[order[i]]).toBeGreaterThan(indexes[order[i - 1]])
    }
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
