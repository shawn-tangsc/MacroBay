/**
 * 跑前断言：这次验证**跑在哪棵树上**。
 *
 * 为什么需要它：今晚两次全量验证都被“边跑边提交”污染——7 分钟的验证跑在一棵一直变的树上，
 * 红绿都不可信。缺的不是更多检查，是**这次结果对应的那个坐标**。
 *
 * 输出一行机器可读的报告（谁都能 grep，也能直接贴进回票）：
 *
 *   verify-preflight head=<sha> dirty=<n> started_at=<ISO> verdict=clean|polluted
 *
 * - 默认（warn）：不阻断，但把 `verdict=polluted` 打在最显眼处——**后续任何“绿”都标为受污染**；
 * - `--strict`：工作区不干净直接非零退出，不跑后续。封版/发布前用这个（`pnpm verify:sole`）。
 *
 * 为什么不默认阻断：日常验证经常跑在“刚改完还没提交”的树上，直接阻断会逼人去找 `--no-verify`
 * 一类的绕过，而那正是这套门禁最怕的东西——**允许跑、但结果不能冒充干净结果**。
 */
import { writeFileSync } from 'node:fs'

import { samplePath, sampleTree } from './verify-sample.mts'

type Verdict = 'clean' | 'polluted'

const strict = process.argv.includes('--strict')

const { head, dirty, at: startedAt } = sampleTree()

const verdict: Verdict = dirty === 0 ? 'clean' : 'polluted'

// 把起点采样留给链尾的 `verify:postflight`：没有它，收尾就无从比较。
try {
  writeFileSync(samplePath(), JSON.stringify({ head, dirty, at: startedAt }))
} catch (error) {
  // 写不进去（只读临时目录之类）：不阻断验证，但明确说出「这次没有收尾见证」。
  console.log(`verify-preflight: could not record the start sample (${String(error)}); this run cannot be attested at the end.`)
}

// 一行，字段顺序固定：谁想解析都不必读第二行。
console.log(
  `verify-preflight head=${head} dirty=${dirty < 0 ? 'unknown' : dirty} started_at=${startedAt} verdict=${verdict}`
)

if (verdict === 'polluted') {
  const reason = dirty < 0 ? 'this tree is not a git checkout, so its state cannot be attested' : `the working tree has ${dirty} uncommitted path(s)`
  // warn 模式也要把结论说到最显眼：不阻断，但别让它看起来像一次干净的全量。
  console.log(`verify-preflight: WARNING — ${reason}. Any green below is a POLLUTED result.`)
  console.log('verify-preflight: run `pnpm verify:sole` on a committed tree when the result has to be trusted.')
  if (strict) {
    console.error('verify-preflight: --strict requested and the tree is not clean; stopping before any check runs.')
    process.exit(1)
  }
}
