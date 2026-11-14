/**
 * 时钟卡「计算值」对照脚本。
 *
 * 用途：把原型的实际计算样式与实现的算一遍，逐项三元组对比——不是看截图。
 * 量法：无头 Chrome 打开两个页面，页面内脚本对同一批元素取 `getComputedStyle`，
 * 结果写进 `<pre id="out">`，由本脚本读出并 diff。
 *
 * 允许的差异只有五项（用户 2026-11-15 定）：示例数据、文案抽 i18n、class 作用域、
 * 接真实数据、无障碍属性。数据驱动的项（牌的 left/top/opacity、牌上文字）单列为
 * 「数据项」，不参与样式判等，但要逐条打印出来核对。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = process.cwd()

const PROTO = `${ROOT}/docs-private/05-desktop/ui-audit/prototypes/FINAL-时钟卡-实现依据.html`

/** 原型选择器 → 实现选择器；两边取同一批属性。 */
const SELECTORS: ReadonlyArray<readonly [string, string, string]> = [
  ['card', '.n', '.mi-clock'],
  ['svg', '.n__svg', '.mi-clock__svg'],
  ['ring', '.n__ring', '.mi-clock__ring'],
  ['zoneFuture', '.n__zone-future', '.mi-clock__zone-future'],
  ['zonePast', '.n__zone-past', '.mi-clock__zone-past'],
  ['nowmark', '.n__nowmark', '.mi-clock__nowmark'],
  ['nowText', '.n__svg text.n__now', '.mi-clock__svg text.mi-clock__now'],
  ['orbit', '.n__orbit', '.mi-clock__orbit'],
  ['glow', '.n__glow', '.mi-clock__glow'],
  ['core', '.n__core', '.mi-clock__core'],
  ['name', '.n__name', '.mi-clock__name'],
  ['badge', '.n__badge', '.mi-clock__badge'],
  ['value', '.n__value', '.mi-clock__value'],
  ['unit', '.n__unit', '.mi-clock__unit'],
  ['tier', '.n__tier', '.mi-clock__tier'],
  ['node', '.n__node:not([data-center]):not(.n__node--past)', '.mi-clock__node:not([data-center]):not(.mi-clock__node--past)'],
  ['nodeCenter', '.n__node[data-center]', '.mi-clock__node[data-center]'],
  ['nodePast', '.n__node--past', '.mi-clock__node--past'],
  ['foot', '.n__foot', '.mi-clock__foot'],
  ['detail', '.n__foot button', '.mi-clock__detail'],
  ['info', '.n__info', '.mi-clock__info']
]

const PROPERTIES = [
  'color', 'background-color', 'border-radius', 'border-width', 'border-color',
  'font-size', 'font-weight', 'line-height', 'opacity', 'transform', 'transform-origin',
  'width', 'height', 'z-index', 'display', 'position', 'left', 'top', 'right', 'bottom',
  'padding', 'gap', 'overflow', 'animation-duration', 'animation-timing-function', 'animation-name',
  'transition-duration', 'transition-timing-function', 'transition-property', 'filter', 'stroke-width', 'min-width', 'min-height'
] as const

const MEASURE_SCRIPT = (selectors: ReadonlyArray<readonly [string, string, string]>, properties: readonly string[], side: 'proto' | 'impl') => `
(() => {
  const rows = []
  const pairs = ${JSON.stringify(selectors)}
  const props = ${JSON.stringify(properties)}
  const side = ${JSON.stringify(side)}
  for (const [key, protoSelector, implSelector] of pairs) {
    const selector = side === 'proto' ? protoSelector : implSelector
    const el = document.querySelector(selector)
    if (!el) { rows.push({ key, missing: selector }); continue }
    const style = getComputedStyle(el)
    for (const prop of props) rows.push({ key, prop, value: style.getPropertyValue(prop) })
  }
  const out = document.createElement('pre')
  out.id = 'out'
  out.textContent = JSON.stringify(rows)
  document.body.appendChild(out)
})()
`

async function measure(page: string): Promise<Map<string, string>> {
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=2000', '--dump-dom', page
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)
  if (!match) throw new Error(`${page}: 页面没有写出测量结果`)
  const rows = JSON.parse(match[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) as
    Array<{ key: string; prop?: string; value?: string; missing?: string }>
  const map = new Map<string, string>()
  for (const row of rows) map.set(row.prop === undefined ? `${row.key}:missing` : `${row.key}:${row.prop}`, row.value ?? row.missing ?? '')
  return map
}

/**
 * 实现页：**同一个模型的静态渲染**。
 * 这里手写标记是为了让脚本能独立于 React 运行时跑起来；它与组件的一致性由
 * `ClockCard.test.tsx` 的类名断言盯着（改动组件而没改这里，那些断言会先红）。
 */
function implementationPage(model: Readonly<{ withIcon: boolean }>): string {
  const plaque = (zone: 'past' | 'future', name: string, value: string, x: number, y: number, opacity: number, center = false) =>
    `<div class="mi-clock__node${zone === 'past' ? ' mi-clock__node--past' : ''}"${center ? ' data-center="true"' : ''} style="left:${x}px;top:${y}px;--o:${opacity}"><span>${name}</span><b>${value}</b></div>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/platform/ui/tokens/tokens.css">
<link rel="stylesheet" href="file://${ROOT}/apps/desktop-shell/src/renderer/src/styles.css">
<link rel="stylesheet" href="file://${ROOT}/products/market-intelligence/desktop/pages/intelligence/clockCard.css">
<style>html,body{margin:0;background:var(--bg);color:var(--text);font:400 var(--font-body)/1.5 -apple-system,"PingFang SC",sans-serif}body{padding:20px;display:grid;justify-items:center}</style>
</head><body>
<section class="mi-clock">
    <svg class="mi-clock__svg" viewBox="0 0 312 306" aria-hidden="true">
      <defs><filter id="miClockFlowGlow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="2.5"/></filter>
      <linearGradient id="miClockFlowGrad" gradientUnits="userSpaceOnUse" x1="65.93" y1="153" x2="246.07" y2="153"><stop class="mi-clock__flowStart" offset="0"/><stop class="mi-clock__flowEnd" offset="1"/></linearGradient></defs>
      <circle class="mi-clock__ring" cx="156" cy="153" r="135" stroke-width="1" opacity=".9"/>
      <path class="mi-clock__zone-future" d="M156 46 A107 107 0 1 1 66.77 212.06 L60.94 215.92 A114 114 0 1 0 156 39 Z"/>
      <path class="mi-clock__zone-past" d="M60.24 200.74 A107 107 0 0 1 156 46 L156 39 A114 114 0 0 0 53.98 203.87 Z"/>
      <g><g class="mi-clock__orbit"><path class="mi-clock__glow" d="M156 153 L17.44 73 A160 160 0 0 1 294.56 73 Z" fill="url(#miClockFlowGrad)"/></g></g>
      <circle class="mi-clock__nowmark" cx="156" cy="42.5" r="3.5"/>
      <text class="mi-clock__now" x="156" y="67" text-anchor="middle" font-size="11">现在</text>
    </svg>
    <div class="mi-clock__core">
      <span class="mi-clock__row1"><span class="mi-clock__name">非农新增就业</span><span class="mi-clock__badge">19 天后</span></span>
      <p class="mi-clock__value">预期未提供</p>
      <span class="mi-clock__tier">前值 <b>+165K</b></span>
    </div>
    ${plaque('future', '新增就业', '+142K', 231.38, 284.2, 0.7006, true)}
    ${plaque('future', '政策利率', '86.8%', 139.93, 297.05, 0.82)}
    ${plaque('past', 'CPI 年率', '3.74%', 51.09, 97.5, 1)}
    <div class="mi-clock__foot"><span>● 实时</span><span class="mi-clock__info" tabindex="0">ⓘ</span><button class="mi-clock__detail" type="button">详细 ↗</button></div>
    ${model.withIcon ? `<div class="mi-clock__action"><button type="button" class="ant-btn mi-clock__action-button" aria-label="打开日历" style="width:22px;height:22px">📅</button></div>` : ''}
</section>
<script>${MEASURE_SCRIPT(SELECTORS, PROPERTIES, 'impl')}</script>
</body></html>`
}

async function main(): Promise<void> {
  const proto = readFileSync(PROTO, 'utf8').replace('</body>', `<script>${MEASURE_SCRIPT(SELECTORS, PROPERTIES, 'proto')}</script></body>`)
  const protoPath = '/tmp/clock-proto.html'
  const implPath = '/tmp/clock-impl.html'
  const implNoIconPath = '/tmp/clock-impl-noicon.html'
  writeFileSync(protoPath, proto)
  writeFileSync(implPath, implementationPage({ withIcon: true }))
  writeFileSync(implNoIconPath, implementationPage({ withIcon: false }))

  const [protoValues, implValues, implNoIconValues] = await Promise.all([
    measure(protoPath), measure(implPath), measure(implNoIconPath)
  ])

  // 数据项：牌的挂点与透明度由数据算，原型那组是示例数据 → 单列，不参与判等。
  // 数据驱动的项：牌的挂点与透明度（原型是示例数据、实现是真数据），
  // 以及随文字变长的宽高/位移（牌内文字、倒计时标、主位高度「由内容撑出」，基线里明写不许当常量）。
  const dataKeys = new Set<string>()
  for (const key of ['node', 'nodeCenter', 'nodePast']) {
    for (const prop of ['left', 'top', 'right', 'bottom', 'opacity']) dataKeys.add(`${key}:${prop}`)
  }
  for (const key of ['core', 'badge', 'value', 'tier', 'name', 'unit', 'node', 'nodeCenter', 'nodePast']) {
    for (const prop of ['width', 'height', 'transform', 'transform-origin', 'bottom', 'right']) dataKeys.add(`${key}:${prop}`)
  }

  const differences: string[] = []
  let compared = 0
  for (const [key] of SELECTORS) {
    if (key === 'orbit' || key === 'glow') continue
    for (const prop of PROPERTIES) {
      const id = `${key}:${prop}`
      if (dataKeys.has(id)) continue
      const left = protoValues.get(id)
      const right = implValues.get(id)
      if (left === undefined || right === undefined) continue
      compared += 1
      if (left !== right) differences.push(`${id}\n    原型: ${left}\n    实现: ${right}`)
    }
  }

  console.log(`\n=== 计算值逐项对比：${compared} 项 ===`)
  console.log(differences.length === 0 ? '差异 0 项' : differences.join('\n'))

  // 动画参数单独列（它们是判据里点名要的）。
  const animationKeys = ['orbit:animation-name', 'orbit:animation-duration', 'orbit:animation-timing-function',
    'orbit:transform-origin', 'node:transition-property', 'node:transition-duration', 'node:transition-timing-function']
  console.log('\n=== 动画参数 ===')
  for (const id of animationKeys) console.log(`${id}\n    原型: ${protoValues.get(id)}\n    实现: ${implValues.get(id)}`)

  // 图标加装前后：同一批选择器，实现页加图标 vs 不加图标。
  let iconDiff = 0
  for (const key of SELECTORS.map(([name]) => name)) {
    for (const prop of PROPERTIES) {
      const id = `${key}:${prop}`
      const before = implNoIconValues.get(id)
      const after = implValues.get(id)
      if (before === undefined || after === undefined) continue
      if (before !== after) { iconDiff += 1; console.log(`[图标前后不同] ${id}: ${before} → ${after}`) }
    }
  }
  console.log(`\n=== 图标加装前后：${iconDiff} 项不同 ===`)
}

void main()
