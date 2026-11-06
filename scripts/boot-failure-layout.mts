/**
 * 启动失败页的窄视口验收（手动运行，不进 CI）。
 *
 * 为什么需要这个脚本：这一页的布局只能在真实浏览器里量，单元测试跑在 happy-dom 里，没有排版引擎。
 *
 * **工具陷阱（踩过一次，务必先读）**：Chrome headless 有 500px 的最小布局宽度——
 * `--window-size=350` 得到的 `innerWidth` 仍是 500，截图是「按 500 布局、再裁到 350」。
 * 所以直接截图看「右边被切」会误判成溢出，而且裁切会掩盖真实差异（两张图的 sha256 甚至相同）。
 * 正确做法是**用 iframe 承载页面**：iframe 的宽度就是内部布局的宽度，再跨帧读它的 DOM 数值。
 *
 * 判据三条（宽度 350 / 420 / 472 / 473 / 520）：
 *   1. 不溢出：卡片与 `.actions` 都满足 `scrollWidth === clientWidth`；
 *   2. 不裁字：三个按钮的文字没有被截断（`scrollHeight === clientHeight`）；
 *   3. 同行等高：三个按钮在任一宽度下高度相同。
 *
 * 用法：`pnpm exec tsx scripts/boot-failure-layout.mts`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { formatBootFailureLogPath, renderBootFailurePage } from '../platform/desktop/main/bootFailurePage'
import { presentBootFailure } from '../platform/desktop/main/failurePresentation'

const WIDTHS = [350, 420, 472, 473, 520] as const
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CHROME = process.env.CHROME_BIN ?? DEFAULT_CHROME

/**
 * 找不到浏览器时**只打一句人话、退出码 2**。
 *
 * 为什么这一句值得单独写：它是这个脚本唯一能跑到它的地方——没有 `CHROME_BIN`、默认路径也不存在时，
 * 原来的写法会在这里抛 `execFileSync` 的 ENOENT 堆栈，读的人看不出要设什么；而"跑不起来时的那条报错"
 * 正是它变成孤儿的第 0 天。退出码 2 也和"布局真的溢出"（1）分开：一个是环境缺件，一个是页面坏了。
 */
if (!existsSync(CHROME)) {
  console.error('check:boot-page: set CHROME_BIN to a Chrome/Chromium binary')
  process.exit(2)
}

const { profile, pagePath, harnessDir } = (() => {
  const root = mkdtempSync(join(tmpdir(), 'boot-failure-layout-'))
  return { profile: join(root, 'profile'), pagePath: join(root, 'page.html'), harnessDir: root }
})()

const screen = presentBootFailure({
  code: 'product-bootstrap-failed',
  stage: 'register-product-services',
  productId: 'market-intelligence',
  reason:
    "Cannot find module '/Users/alice/project/AI/MacroBay/products/market-intelligence/product.manifest.ts' imported from /Users/alice/project/AI/MacroBay/platform/desktop/main/app.ts"
})
writeFileSync(pagePath, renderBootFailurePage(screen, {
  locale: 'zh-CN',
  logPath: formatBootFailureLogPath('darwin', '/Users/alice/Library/Application Support/MacroBay/logs')
}))

const measure = (width: number): Record<string, unknown> => {
  const harnessPath = join(harnessDir, `harness-${width}.html`)
  writeFileSync(harnessPath, `<!doctype html><body style="margin:0">
<iframe id="f" src="file://${pagePath}" style="width:${width}px;height:900px;border:0"></iframe>
<script>
window.addEventListener('load', () => {
  const f = document.getElementById('f')
  setTimeout(() => {
    const d = f.contentDocument
    const card = d.querySelector('.card')
    const actions = d.querySelector('.actions')
    const buttons = [...d.querySelectorAll('.actions a')]
    document.title = JSON.stringify({
      viewport: f.contentWindow.innerWidth,
      cardWidth: Number(card.getBoundingClientRect().width.toFixed(1)),
      cardOverflow: card.scrollWidth > card.clientWidth,
      actionsOverflow: actions.scrollWidth > actions.clientWidth,
      buttons: buttons.map((b) => ({
        text: b.textContent,
        height: Number(b.getBoundingClientRect().height.toFixed(1)),
        clipped: b.scrollHeight > b.clientHeight
      }))
    })
  }, 250)
})
</script></body>`)

  const dom = execFileSync(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--allow-file-access-from-files',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=1500',
    '--dump-dom',
    '--window-size=900,940',
    `file://${harnessPath}`
  ], { encoding: 'utf8' })
  const match = /<title>([^<]*)<\/title>/u.exec(dom)
  if (!match) throw new Error(`width ${width}: the harness never reported a measurement`)
  return JSON.parse(match[1]) as Record<string, unknown>
}

let failures = 0
for (const width of WIDTHS) {
  const result = measure(width) as {
    viewport: number
    cardWidth: number
    cardOverflow: boolean
    actionsOverflow: boolean
    buttons: Array<{ text: string; height: number; clipped: boolean }>
  }
  const heights = new Set(result.buttons.map((button) => button.height))
  const problems: string[] = []
  if (result.viewport !== width) problems.push(`viewport is ${result.viewport}, not ${width} (the harness itself is wrong)`)
  if (result.cardOverflow || result.actionsOverflow) problems.push('overflow: scrollWidth > clientWidth')
  if (result.buttons.some((button) => button.clipped)) problems.push('a button clips its text')
  if (heights.size !== 1) problems.push(`buttons differ in height: ${[...heights].join(' / ')}`)

  const summary = `viewport ${width}: card ${result.cardWidth}px, buttons ${[...heights].join('/')}px`
  if (problems.length > 0) {
    failures += 1
    process.stderr.write(`✗ ${summary} — ${problems.join('; ')}\n`)
  } else {
    process.stdout.write(`✓ ${summary}\n`)
  }
}

process.stdout.write(failures === 0 ? '\nboot failure page: all widths pass\n' : `\n${failures} width(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
