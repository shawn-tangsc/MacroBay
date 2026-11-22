/**
 * 离屏截图的一次性窗口：起一个不显示的窗口，加载某一页，等它自己报「画好了」，量尺寸、截图、
 * 销毁。**一律在 `finally` 里销毁**——只放弃等待不拆窗口，就是另一个泄漏。
 *
 * 三条硬约束写在这里，而不是写在使用处（2026-11-22 的裁决）：
 * 1. **整条链一个总墙钟预算**（默认 15s），窗口创建 + 载入 + 字体 + 截图 + 写盘全算在内；
 *    不依赖页面自己报超时——它卡住就不会报。
 * 2. 判定只看页面写在 `documentElement.dataset` 上的就绪标记，**不猜「应该画完了」**：
 *    标记是 `ready` 才截图，`failed` 直接算失败。等不到标记＝超时。
 * 3. 尺寸不对**不截**：截一张糊的图不会报错，读者只会拿到一张看不清的纸。
 *
 * 这个模块不认识海报、不认识简报：`query` 是调用方给窗口的参数，就绪标记的名字也由调用方给。
 * 窗口怎么建（preload、导航拒绝、隐藏）归组合根——那里才 import electron。
 */

export type OffscreenWindow = {
  loadURL: (url: string) => Promise<void>
  executeJavaScript: <T>(code: string) => Promise<T>
  setContentSize: (width: number, height: number) => void
  capturePage: (rect: { x: number; y: number; width: number; height: number }) => Promise<{ toPNG: () => Uint8Array }>
  destroy: () => void
}

export type OffscreenCaptureOutcome =
  | Readonly<{ ok: true; bytes: Uint8Array; width: number; height: number }>
  | Readonly<{
    ok: false
    reason: 'timeout' | 'load-failed' | 'render-failed' | 'capture-failed'
    /** 页面自己给的失败细节（原因码），只作证据、不参与判定。 */
    detail?: string
  }>

export type OffscreenCaptureInput = Readonly<{
  createWindow: () => OffscreenWindow
  /** 页面入口（`file://…/index.html` 或 dev server 地址）。查询串由 `query` 拼。 */
  entryUrl: string
  query: Record<string, string>
  /** 页面写就绪状态的两个属性名（`documentElement.dataset` 上的键）。 */
  stateAttribute: string
  errorAttribute?: string
  /** 页面里要被截的那个元素的 CSS 选择器；量宽度、定截图区域都用它。 */
  selector: string
  /** 期望的内容宽度（等于才截）。 */
  expectedWidth: number
  budgetMs?: number
  pollMs?: number
  /** 测试接缝：默认真等。 */
  wait?: (ms: number) => Promise<void>
  now?: () => number
}>

const DEFAULT_BUDGET_MS = 15_000
const DEFAULT_POLL_MS = 50

function withQuery(entryUrl: string, query: Record<string, string>): string {
  const search = new URLSearchParams(query).toString()
  if (search.length === 0) return entryUrl
  return `${entryUrl}${entryUrl.includes('?') ? '&' : '?'}${search}`
}

export async function captureOffscreenWindow(input: OffscreenCaptureInput): Promise<OffscreenCaptureOutcome> {
  const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS
  const pollMs = input.pollMs ?? DEFAULT_POLL_MS
  const wait = input.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const now = input.now ?? (() => Date.now())
  const deadline = now() + budgetMs

  const window = input.createWindow()
  try {
    try {
      await window.loadURL(withQuery(input.entryUrl, input.query))
    } catch {
      return { ok: false, reason: 'load-failed' }
    }

    for (;;) {
      const state = await window.executeJavaScript<string | null>(
        `document.documentElement.dataset[${JSON.stringify(input.stateAttribute)}] ?? null`
      ).catch(() => null)
      if (state === 'failed') {
        const detail = input.errorAttribute === undefined
          ? undefined
          : await window.executeJavaScript<string | null>(
            `document.documentElement.dataset[${JSON.stringify(input.errorAttribute)}] ?? null`
          ).catch(() => null)
        return { ok: false, reason: 'render-failed', ...(typeof detail === 'string' ? { detail } : {}) }
      }
      if (state === 'ready') break
      if (now() >= deadline) return { ok: false, reason: 'timeout' }
      await wait(pollMs)
    }

    // 量出来必须正好是期望宽度：差一点就是「小一号、糊一点」，界面上看不出来，读者看得出来。
    const measured = await window.executeJavaScript<{ width?: number; height?: number } | null>(`(() => {
      const element = document.querySelector(${JSON.stringify(input.selector)})
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { width: Math.round(rect.width), height: Math.round(rect.height) }
    })()`).catch(() => null)
    const width = Math.round(measured?.width ?? 0)
    const height = Math.round(measured?.height ?? 0)
    if (width !== input.expectedWidth || height <= 0) {
      return { ok: false, reason: 'render-failed', detail: `size-${width}x${height}` }
    }

    // 尺寸变化后要再让页面画两帧，否则截到的是改尺寸之前的旧帧。
    window.setContentSize(width, height)
    await wait(2 * 16)

    const image = await window.capturePage({ x: 0, y: 0, width, height })
    return { ok: true, bytes: image.toPNG(), width, height }
  } catch {
    return { ok: false, reason: 'capture-failed' }
  } finally {
    window.destroy()
  }
}