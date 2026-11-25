import { BrowserWindow } from 'electron'

import { MAIN_WINDOW_PRELOAD_PATH, SECURE_WINDOW_PREFERENCE_BASELINE } from '../../window/createMainWindow'
import { captureOffscreenWindow, type OffscreenCaptureOutcome } from './offscreenCaptureWindow'

/**
 * 隐藏窗口画海报的**唯一实现**：入口 URL 与 preload 由组合根给，窗口纪律写死在这里。
 *
 * 纪律（方案 §12.2）：`show:false`、不节流、新窗口与导航一律拒、用完即 `destroy()`
 * （`captureOffscreenWindow` 的 `finally` 保证，成功失败都拆）。
 *
 * 参数里的 `product` / `entry` 是产品自己声明的窗口入口身份——这里不认识任何产品名。
 */
export type BriefingPosterCaptureInput = Readonly<{
  product: string
  entry: string
  params: Readonly<Record<string, string>>
}>

export type BriefingPosterCapture = (input: BriefingPosterCaptureInput) => Promise<OffscreenCaptureOutcome>

/** 初始窗口尺寸：宽=印刷宽；高度先给够，真实高度由页面量出来再改（判定在 `captureOffscreenWindow`）。 */
const INITIAL_WIDTH = 1080
const INITIAL_HEIGHT = 1400

export function createBriefingPosterCapture(input: Readonly<{
  entryUrl: string
  preload: string
}>): BriefingPosterCapture {
  return (request) => captureOffscreenWindow({
    createWindow: () => {
      const window = new BrowserWindow({
        show: false,
        width: INITIAL_WIDTH,
        height: INITIAL_HEIGHT,
        // 窗口不可见：底色只为避免截图出现透明孔洞，海报自己画纸。
        backgroundColor: '#ffffff',
        webPreferences: {
          ...SECURE_WINDOW_PREFERENCE_BASELINE,
          preload: input.preload,
          backgroundThrottling: false
        }
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      return {
        loadURL: async (url: string) => { await window.loadURL(url) },
        executeJavaScript: <T>(code: string) => window.webContents.executeJavaScript(code) as Promise<T>,
        setContentSize: (width: number, height: number) => window.setContentSize(width, height),
        capturePage: async (rect) => {
          const image = await window.webContents.capturePage(rect)
          return { toPNG: () => image.toPNG() }
        },
        destroy: () => { if (!window.isDestroyed()) window.destroy() }
      }
    },
    entryUrl: input.entryUrl,
    query: { window: 'poster', product: request.product, entry: request.entry, ...request.params },
    stateAttribute: 'posterState',
    errorAttribute: 'posterError',
    selector: '.mi-brief-poster',
    expectedWidth: INITIAL_WIDTH
  })
}

export { MAIN_WINDOW_PRELOAD_PATH }
