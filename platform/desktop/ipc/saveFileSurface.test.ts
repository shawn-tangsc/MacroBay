import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, it } from 'vitest'

import { IpcChannels } from './channels'

/**
 * 保存桥的**面**：一条通道、一个动作、不收路径。
 *
 * 这是那个受保护接缝的回归守卫（动 `channels.ts` / preload / main 时要求「前后 IPC 面对比」）：
 * - 渲染层只能给「建议文件名 + 字节」，**不能给路径**——给了就等于任何页面都能往任意位置写文件；
 * - preload 只多这一个动作，不许顺带把 `fs` 或整个 `ipcRenderer` 透出去。
 */
const root = resolve(process.cwd(), 'platform/desktop')
const preload = readFileSync(resolve(root, 'preload/index.ts'), 'utf8')
const main = readFileSync(resolve(root, 'main/ipc/windowIpc.ts'), 'utf8')

it('exposes exactly one save action, and it takes a name and bytes only', () => {
  expect(IpcChannels.appSaveFile).toBe('platform:app-save-file')
  // preload：签名就是 (suggestedName, bytes)
  expect(preload).toContain('saveFile: (suggestedName: string, bytes: Uint8Array) =>')
  expect(preload).toContain('ipcRenderer.invoke(IpcChannels.appSaveFile, { suggestedName, bytes })')
  // 不许把底层通道整个透出去（`ipcRenderer` 只许作为 import 与 `.invoke/.on` 的接收者出现）：
  // 把 `ipcRenderer` 交给渲染层，等于把「任意通道」的口子开到页面里。
  expect(preload).not.toMatch(/ipcRenderer\s*[,}]\s*$/mu)
  expect(preload).not.toMatch(/\bipcRenderer:\s*ipcRenderer\b/u)
  expect(preload).not.toMatch(/\bfs:\s*(?:fs|require\('fs'\))/u)
})

it('lets main choose the path, and refuses an empty or oversized payload', () => {
  // main 里必须走保存对话框，并只取 basename（建议名不许带出目录）。
  expect(main).toContain('IpcChannels.appSaveFile')
  expect(main).toContain('dialog.showSaveDialog')
  expect(main).toContain('basename(suggestedName.trim())')
  // 空字节与超大字节都拒绝：写完才发现是 0 字节文件，比不导出更糟。
  expect(main).toContain('bytes.byteLength === 0')
  expect(main).toContain('20 * 1024 * 1024')
})
