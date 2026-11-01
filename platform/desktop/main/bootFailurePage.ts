import type { ScreenFailure } from './failurePresentation'

/**
 * 启动失败页：在所有业务模块都没起来的时候渲染。
 *
 * 硬约束，少一条这页就会在最需要它的时候打不开：
 * - 不读应用主题（主题存在 settings.json，正是可能挂掉的一环），只跟系统 `prefers-color-scheme`；
 * - 不读 `platformText`（i18n 表也在启动链上），内置一份中英字典，按 locale 选；
 * - 不 import 任何产品模块；CSS 与文案全部内联，没有一个外部请求。
 */

export type BootFailureLocale = 'zh-CN' | 'en-US'

const DICTIONARY = {
  'zh-CN': {
    title: '应用未能启动',
    reasonLead: (productId: string | null) =>
      productId
        ? `产品模块「${productId}」未能注册，应用停在了启动阶段。你的设置和数据没有被改动。`
        : '应用停在了启动阶段。你的设置和数据没有被改动。',
    codeLabel: '错误码',
    detailsLabel: '技术详情',
    detailsHint: '可上下滚动 · 可全选复制',
    logLabel: '日志文件',
    retry: '重试',
    logs: '打开日志位置',
    quit: '退出应用',
    retryHint: '重试会用同一份配置再启动一次。仍失败时，把上面路径里的日志文件发给开发者。'
  },
  'en-US': {
    title: 'The app could not start',
    reasonLead: (productId: string | null) =>
      productId
        ? `The product module "${productId}" failed to register, so startup stopped. Your settings and data were not changed.`
        : 'Startup stopped. Your settings and data were not changed.',
    codeLabel: 'Error code',
    detailsLabel: 'Technical details',
    detailsHint: 'Scrolls · can be selected and copied',
    logLabel: 'Log file',
    retry: 'Retry',
    logs: 'Open log folder',
    quit: 'Quit',
    retryHint: 'Retry starts the app again with the same configuration. If it still fails, send the log file above to the developer.'
  }
} as const

export type BootFailureAction = 'retry' | 'logs' | 'quit'

export interface BootFailurePageOptions {
  locale: string
  /** 已经写成 `~/…` 形式的日志路径：屏幕上不出现家目录与用户名。 */
  logPath: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

export function normalizeBootFailureLocale(locale: string): BootFailureLocale {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function renderBootFailurePage(failure: ScreenFailure, options: BootFailurePageOptions): string {
  const locale = normalizeBootFailureLocale(options.locale)
  const copy = DICTIONARY[locale]
  const reasonLead = copy.reasonLead(failure.productId)
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(copy.title)}</title>
<style>
  :root { color-scheme: light dark; --fg:#1c1c1e; --bg:#f6f6f7; --card:#fff; --line:#e3e3e6; --muted:#6b6b72; --accent:#2f6fed; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8ea; --bg:#1b1b1d; --card:#242427; --line:#3a3a3f; --muted:#9a9aa2; --accent:#7aa2ff; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--fg);
         font:13px/1.6 -apple-system, "Segoe UI", "Noto Sans SC", sans-serif; }
  /* 这页挂在任意窗口上（函数签名就是 BrowserWindow），不是只在 960px 的主窗：窄窗要收缩，不能把按钮裁掉。 */
  .card { width:100%; max-width:472px; min-width:0; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:24px; }
  h1 { margin:0 0 12px; font-size:16px; }
  .lead { color:var(--muted); margin:0 0 8px; }
  .reason { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin:0 0 12px;
            font-family:ui-monospace, SFMono-Regular, Menlo, monospace; word-break:normal; overflow-wrap:anywhere; }
  .code-row { display:flex; gap:8px; align-items:baseline; margin:0 0 16px; }
  .code-label { color:var(--muted); }
  .code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  details { border-top:1px solid var(--line); padding-top:10px; }
  summary { cursor:pointer; color:var(--muted); display:flex; justify-content:space-between; gap:8px; }
  pre { max-height:118px; overflow-y:auto; overflow-x:hidden; white-space:pre-wrap; word-break:normal; overflow-wrap:anywhere;
        font-family:ui-monospace, SFMono-Regular, Menlo, monospace; margin:8px 0 0;
        /* 技术详情必须有自己的视觉边界：否则用户分不清哪段能复制、哪段是我们的说明。 */
        border:1px solid var(--line); background:var(--bg); border-radius:6px; padding:8px; }
  .log { color:var(--muted); margin:12px 0 0; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap:anywhere; user-select:text; }
  .actions { display:flex; gap:8px; margin:16px 0 0; }
  a.button { flex:1; text-align:center; padding:7px 10px; border-radius:6px; border:1px solid var(--line); color:var(--fg); text-decoration:none; }
  a.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .hint { color:var(--muted); margin:10px 0 0; }
</style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="lead">${escapeHtml(reasonLead)}</p>
    <p class="reason">${escapeHtml(failure.reason)}</p>
    <div class="code-row"><span class="code-label">${escapeHtml(copy.codeLabel)}</span><span class="code">${escapeHtml(failure.code)}</span></div>
    <details open>
      <summary><span>${escapeHtml(copy.detailsLabel)}</span><span>${escapeHtml(copy.detailsHint)}</span></summary>
      <pre>${escapeHtml(failure.reasonFull)}</pre>
    </details>
    <p class="log">${escapeHtml(copy.logLabel)}: ${escapeHtml(options.logPath)}</p>
    <div class="actions">
      <a class="button primary" href="macrobay-boot:retry">${escapeHtml(copy.retry)}</a>
      <a class="button" href="macrobay-boot:logs">${escapeHtml(copy.logs)}</a>
      <a class="button" href="macrobay-boot:quit">${escapeHtml(copy.quit)}</a>
    </div>
    <p class="hint">${escapeHtml(copy.retryHint)}</p>
  </main>
</body>
</html>`
}

/**
 * 屏幕上的日志路径：用 `~` 或 `%APPDATA%` 代替家目录。用户能自己找到，截图里不出现用户名。
 */
export function formatBootFailureLogPath(platform: NodeJS.Platform, logDirectory: string): string {
  const segments = logDirectory.split(/[\\/]+/u).filter(Boolean)
  const product = segments.length >= 2 ? segments[segments.length - 2] : 'MacroBay'
  if (platform === 'win32') return `%APPDATA%\\${product}\\logs\\app.log`
  if (platform === 'darwin') return `~/Library/Application Support/${product}/logs/app.log`
  return `~/.config/${product}/logs/app.log`
}

/** 把页面里的 `macrobay-boot:` 导航解析成动作；不是我们的链接就返回 `null`。 */
export function resolveBootFailureAction(url: string): BootFailureAction | null {
  const match = /^macrobay-boot:(retry|logs|quit)$/u.exec(url)
  return match ? (match[1] as BootFailureAction) : null
}
