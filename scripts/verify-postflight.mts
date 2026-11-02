/**
 * 跑后采样：**这次验证的结论属于哪棵树**。
 *
 * 与 `verify-preflight` 成对：起点报了 `head/dirty`，这里再报一次并比较。不一致就判
 * `result=invalid` 并非零退出——它既不是绿也不是红，是「跑的时候有人在改」，必须重跑。
 *
 * 为什么不让 preflight 自己收尾：它跑完就退出，后面才是真正的检查。收尾只能挂在链尾。
 * 代价是「前半程就红」时它不执行——那种情况本来也不会被当绿，所以不构成假绿的口子。
 */
import { existsSync, readFileSync } from 'node:fs'

import { compareSamples, samplePath, sampleTree, type TreeSample } from './verify-sample'

const path = samplePath()
if (!existsSync(path)) {
  console.error('verify-postflight: no start sample (was `verify:preflight` skipped?). A run without both samples is not attested.')
  process.exit(1)
}

const start = JSON.parse(readFileSync(path, 'utf8')) as TreeSample
const end = sampleTree()
const strict = process.argv.includes('--strict')
const { verdict, attributable, reason } = compareSamples(start, end)

console.log(
  `verify-postflight head=${end.head} dirty=${end.dirty < 0 ? 'unknown' : end.dirty} started_at=${start.at} ended_at=${end.at} result=${verdict} attributable=${attributable ? 'yes' : 'no'}`
)

if (verdict === 'invalid') {
  console.error(`verify-postflight: THIS RUN IS INVALID — ${reason}.`)
  console.error('verify-postflight: do not quote its red or green; re-run on a tree nobody is editing.')
  process.exit(1)
}
if (verdict === 'unknown') {
  console.log(`verify-postflight: result is UNKNOWN — ${reason}. Not attributable to any commit.`)
}
if (verdict === 'polluted') {
  console.log(`verify-postflight: result is POLLUTED — ${reason}. A green here means "not broken right now", not "this commit is green".`)
}
if (verdict === 'valid') {
  console.log(`verify-postflight: result is VALID — ${reason}. This is the only shape a closing run may have.`)
}

// `verify:sole` 只认 `valid`：首尾一致但脏（`polluted`）也不能关账，无 git 更不能。
if (strict && verdict !== 'valid') {
  console.error(`verify-postflight: --strict requires result=valid, got ${verdict}; this run cannot close an item.`)
  process.exit(1)
}
