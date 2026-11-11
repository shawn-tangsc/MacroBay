/**
 * 验证的执行器：**链不短路**。
 *
 * 为什么不能再用 `pnpm a && pnpm b && …`：前半程一红，末尾那次采样就永远不执行，于是这次红被
 * **默认钉在起点那个提交上**——可它可能是别人半笔改出来的。假绿要防，假红一样要防。
 *
 * 所以顺序改成：起点采样 → 逐项检查（第一处失败即停，不再往下堆噪音）→ **无论如何**终点采样 →
 * 按「检查是否全过」与「采样结论」一起决定退出码。
 *
 * 检查清单只在这里出现一次：`package.json` 指向本脚本，`AGENTS.md` 的步骤表与 `verificationEntry`
 * 守卫都读它——三处各写一份，就是今晚已经修过一次的那种漂移。
 */
import { spawnSync } from 'node:child_process'

import { VERIFY_CHECKS } from './verify-sample'

const strict = process.argv.includes('--strict')

function run(command: string, args: readonly string[]): number {
  // Windows 上 `pnpm` 只有 `.cmd`/`.ps1` 两种入口，没有 `.exe`：`spawnSync` 不走 PATHEXT，
  // 直接调用会以 `ENOENT` 失败并返回 `status: null`，而这条链把它读成「检查失败」——
  // 于是整条门禁在 Windows 上一个字不打印就红。过一层 shell 才解析得到 `pnpm.cmd`。
  // 参数全部是脚本里的字面量，没有外部输入，不经引号拼接。
  const result = spawnSync(command, [...args], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) {
    console.error(`[verify] could not start "${command}": ${String((result.error as NodeJS.ErrnoException).code)}`)
  }
  return result.status ?? 1
}

// ① 起点：`--strict` 时脏树不跑（`verify:sole`）。
const preflight = run('pnpm', ['exec', 'tsx', 'scripts/verify-preflight.mts', ...(strict ? ['--strict'] : [])])
if (preflight !== 0) {
  // 起跑线就不合格：没有可信的起点，也就不用造一个终点结论去骗人。
  process.exit(preflight)
}

// ② 检查：第一处失败即停，但**一定要走到 ③**。
let failed: string | null = null
for (const check of VERIFY_CHECKS) {
  const startedAt = Date.now()
  const code = run('pnpm', [check])
  // 每项单独计时：CI runner 与本机的速度差可能到两三倍，均摊到整条链里就分不出是哪一项慢。
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[verify] ${check}: ${seconds}s (${code === 0 ? 'ok' : 'failed'})`)
  if (code !== 0) {
    failed = check
    break
  }
}

// ③ 终点：无论前面红绿，都采一次样——这次结果属于哪棵树，只有这里能回答。
const postflight = run('pnpm', ['exec', 'tsx', 'scripts/verify-postflight.mts', ...(strict ? ['--strict'] : [])])

if (failed !== null) {
  console.error(`verify: stopped at "${failed}". The post-sample above says which tree this red belongs to.`)
  process.exit(1)
}
process.exit(postflight)
