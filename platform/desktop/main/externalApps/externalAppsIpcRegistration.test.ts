import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Owner: platform/desktop/main/externalApps（**PLAT-32 / PLAT-27** focused）。回归：本文件。
 *
 * 声明于 `platform/desktop/ipc/channels.ts` + `platform/desktop/preload/index.ts`，但**全仓没有任何
 * `ipcMain.handle`**（真机 `startupHandlerNoise` 出现在 `at01-menus` / `at10-capacity`）⇒
 * `OpenExternalAppButton` 的 mount effect 调用它只会 `.catch(() => setApps([]))`，Agent 聊天栏的
 * 「外部应用」列表**永不出现**（fail closed、不崩，但用户可见的功能缺失）。
 *
 * 形态查证（本包先查证再定形态）：主进程侧**确有**可平凡接线的枚举实现
 * （`ExternalAppsService.listInstalledAppViews()` + `launchWorkspace()`，且已有 3 条单测）
 * ⇒ 选**情形 ①：注册 handler**（保留通道声明，不引入能力探测新通道，也不改按钮的 fail-closed 行为）。
 * 本文件固定「声明的通道必须真的有 handler」这条判据，防止死通道再次出现。
 */

const appSource = readFileSync(resolve(__dirname, '../app.ts'), 'utf8')
const channelsSource = readFileSync(resolve(__dirname, '../../ipc/channels.ts'), 'utf8')
const preloadSource = readFileSync(resolve(__dirname, '../../preload/index.ts'), 'utf8')
const buttonSource = readFileSync(
  resolve(__dirname, '../../../../apps/desktop-shell/src/renderer/src/shell/agents/components/AgentChatNavbar/OpenExternalAppButton.tsx'),
  'utf8'
)

/** 声明必须成对存在：通道常量 + preload 具名方法（renderer 的唯一入口）。 */
const declaredChannelKeys = ['externalAppsListInstalled', 'externalAppsLaunchWorkspace'] as const

describe('PLAT-27：外部应用通道不再「已声明但无 handler」', () => {
  it('两个通道常量与 preload 方法成对声明（死通道的声明侧不变）', () => {
    expect(channelsSource).toContain("externalAppsListInstalled: 'platform:external-apps-list-installed'")
    expect(channelsSource).toContain("externalAppsLaunchWorkspace: 'platform:external-apps-launch-workspace'")
    expect(preloadSource).toContain('listExternalApps: () => ipcRenderer.invoke(IpcChannels.externalAppsListInstalled)')
    expect(preloadSource).toContain('ipcRenderer.invoke(IpcChannels.externalAppsLaunchWorkspace, request)')
    // 唯一调用方（按钮 mount effect）确实消费列表 ⇒ 少了 handler 就是用户可见的功能缺失
    expect(buttonSource).toContain('.listExternalApps()')
    expect(buttonSource).toContain('.launchExternalAppWorkspace(')
  })

  it('app.ts 为两个通道各注册恰好一个 handler（当前 0 个 ⇒ RED）', () => {
    for (const channel of declaredChannelKeys) {
      const pattern = `ipcMain.handle(IpcChannels.${channel},`
      expect(appSource.split(pattern).length - 1).toBe(1)
    }
  })

  it('handler 复用既有 ExternalAppsService（不新增第二套枚举实现、不新增通道）', () => {
    expect(appSource).toContain("import { ExternalAppsService } from './externalApps/ExternalAppsService'")
    expect(appSource).toContain('new ExternalAppsService({')
    expect(appSource).toContain('externalAppsService.listInstalledAppViews()')
    expect(appSource).toContain('externalAppsService.launchWorkspace(')
    // 枚举来源必须是 OS 协议处理器查询（真机唯一可信来源），且路径入参经既有 allow-list 校验
    expect(appSource).toContain('app.getApplicationInfoForProtocol(protocol)')
    expect(appSource).toContain('validateLaunchExternalAppRequest(input)')
  })
})

describe('PLAT-27：通道面不因接线而扩面', () => {
  it('不新增任何 external-app 通道（既有 2 条仍是唯一入口）', () => {
    const declared = [...channelsSource.matchAll(/externalApps[A-Za-z]*:/gu)].map((match) => match[0])
    expect(declared).toEqual(['externalAppsListInstalled:', 'externalAppsLaunchWorkspace:'])
  })

  it('preload 暴露的 app 命名空间方法集合不变（仍是 2 条外部应用方法）', () => {
    const preloadMethods = [...preloadSource.matchAll(/^\s{4}(listExternalApps|launchExternalAppWorkspace):/gmu)]
      .map((match) => match[1])
    expect(preloadMethods).toEqual(['listExternalApps', 'launchExternalAppWorkspace'])
  })
})
