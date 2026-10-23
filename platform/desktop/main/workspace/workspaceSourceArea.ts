import type { WorkspaceSize } from '@platform/workspace/contracts'

/**
 * Owner: platform/desktop/main/workspace（P2-14）。
 * 页面窗默认尺寸的**源区域输入**：从 IPC sender（发起 `detachTab` 的那个 renderer，真机＝主窗）读出
 * **源窗口内容区**尺寸（DIP）。
 *
 * 为什么在这里读、而不是让 renderer 自报：renderer 自报的尺寸既非权威（缩放/隐藏挂载/多窗会给出错误值），
 * 又要求扩宽 `.tabs.command` 的字段契约；而 Main 侧对 sender 的真实窗口有权威读权。
 * 与 `resolveSender` 同一姿态：**不 import electron**，只做鸭子类型形状校验；缺任何一环一律 `undefined`
 * （调用方回退 `WorkspaceDetachedWindowPolicy.defaultSize`），绝不猜、绝不把 0/NaN/负数当尺寸。
 *
 * 口径差异（如实记录）：这是「源**窗口内容区**」，比「源**页面区域**」（再去掉左侧图标栏与顶部功能区）
 * 略大，因而只是页面窗的**上界近似**；最终尺寸仍被策略的 `maxWorkAreaRatio` 与 `workAreaMargin` 夹紧，
 * 且真机上不会小到看不见。要逐字等于页面区域需要 renderer 侧测量（属于扩宽 IPC 字段的契约变更）。
 */
export function readSourceAreaSize(event: unknown): WorkspaceSize | undefined {
  try {
    return readSize(event)
  } catch {
    // 尺寸只是**尺寸提示**：任何形状异常（含 renderer 已消失时 Electron 抛错）都不得打断分离事务
    return undefined
  }
}

function readSize(event: unknown): WorkspaceSize | undefined {
  const sender = asRecord(asRecord(event)?.['sender'])
  if (sender === null) return undefined
  const isDestroyed = sender['isDestroyed']
  if (typeof isDestroyed === 'function' && (isDestroyed as () => boolean).call(sender) === true) return undefined
  const getOwnerBrowserWindow = sender['getOwnerBrowserWindow']
  if (typeof getOwnerBrowserWindow !== 'function') return undefined
  const browserWindow = (getOwnerBrowserWindow as () => unknown).call(sender)
  const getContentBounds = asRecord(browserWindow)?.['getContentBounds']
  if (typeof getContentBounds !== 'function') return undefined
  const bounds = asRecord((getContentBounds as () => unknown).call(browserWindow))
  if (bounds === null) return undefined
  const width = bounds['width']
  const height = bounds['height']
  if (!isUsableExtent(width) || !isUsableExtent(height)) return undefined
  return { width: Math.round(width), height: Math.round(height) }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function isUsableExtent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Math.round(value) >= 1
}
