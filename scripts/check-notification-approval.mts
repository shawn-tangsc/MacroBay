/**
 * 「0 missing」守卫（契约 §7.1b 第 6 条）：批准值搬家之前，先给出一份**可复跑**的覆盖率。
 *
 * 落点：`verify` 链（每一次全量都跑）。也可以单独跑：`pnpm -s check:notification-approval`。
 *   - 打印一行结论：`declared=… approved=… missing=… orphaned=… requested-not-approved=…`
 *   - 有缺口时逐条点名（`missing <eventId>`），并以非 0 退出。
 *
 * 为什么它是搬迁的前置证据：兜底删了、用例全绿，都不能证明「删之前一条不缺」——只有这份输出能。
 * 读法（b3-2）：三条来源各读**自己那份**批准——平台读 `PLATFORM_NOTIFICATION_APPROVALS`，
 * 产品读自己 manifest 里的 `notificationApproval`；三个数都从这一份 `sources` 算，没有第二个口径。
 * 没有兜底：来源没带 `approval` 就是 `missing`，不再从别处派生（b3-5 已删兜底与派生视图）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { inspectApprovalCoverage, formatApprovalCoverage, formatApprovalGaps } from '../platform/notifications/contracts/notificationApprovalCoverage'
import type { NotificationApprovalGap } from '../platform/notifications/contracts/notificationApprovalCoverage'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../platform/notifications/contracts/platformNotificationEvents'
import type { NotificationEventDeclarationSource } from '../platform/notifications/contracts/notificationEventCatalog'

/**
 * 生成物按需生成一次（2026-11-08 CI 红过一次）。
 *
 * `products/generated/` 是**构建期生成、不入库**的目录：本机因为跑过生成而一直存在，干净检出
 * （CI、新克隆）里没有。这道检查现在挂在 `verify` 链上，直接静态 import 生成物就会在干净检出上
 * `ERR_MODULE_NOT_FOUND`，整条链在第一步断掉——而且本机永远复现不出来。
 *
 * 所以：先看生成物在不在，不在就生成一次，再动态 import。生成只写 `.gitignore` 里的构建输出，
 * 不动已跟踪文件，`verify:preflight` 的 `dirty` 计数不受影响。
 */
async function loadProductManifests(): Promise<readonly { id: string; notificationEvents?: readonly unknown[]; notificationApproval?: unknown }[]> {
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const generated = resolve(workspaceRoot, 'products/generated/productManifests.ts')
  if (!existsSync(generated)) {
    execFileSync('pnpm', ['-s', 'generate:products'], { stdio: 'inherit', cwd: workspaceRoot })
  }
  const module = (await import(pathToFileURL(generated).href)) as {
    productManifests: readonly { id: string; notificationEvents?: readonly unknown[]; notificationApproval?: unknown }[]
  }
  return module.productManifests
}

const productManifests = await loadProductManifests()

const sources: NotificationEventDeclarationSource[] = [
  // 平台自己的事件，批准值读平台自己声明的那份（b3-2）。以前这里读的是那张共享表——
  // 表里同时抄着 10 条产品批准，于是每个产品事件在「平台来源」下都成了孤儿批准（10 条）。
  { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
  ...productManifests
    .filter((manifest) => (manifest.notificationEvents?.length ?? 0) > 0)
    .map((manifest): NotificationEventDeclarationSource => ({
      productId: manifest.id,
      events: (manifest.notificationEvents ?? []) as NotificationEventDeclarationSource['events'],
      // 批准值随声明走（契约 §7.1b）：产品自己声明，检查脚本也按同一处读。
      ...(manifest.notificationApproval === undefined
        ? {}
        : { approval: manifest.notificationApproval as NotificationEventDeclarationSource['approval'] })
    }))
]

/**
 * **数从哪来**要写在数旁边（Chief 2026-11-08）：工作区跑出的 `missing=0` 与已提交树上跑出的
 * `missing=0` 是两件事——前者可能只是别人还没提交的好意。所以先打 `head` 与 `dirty`，
 * 与 `verify:preflight` 同一个形状：**只有 `dirty=0` 的那一行才可以当作搬迁证据。**
 */
function provenance(): string {
  // 不走 shell：参数用数组传。Windows 上没有 `sh`，`execSync('git …')` 在那边根本不成立
  // （跨平台守卫就是这么拦下这一行的）。
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length
    return `head=${head} dirty=${dirty}`
  } catch {
    return 'head=unknown dirty=unknown'
  }
}

const coverage = inspectApprovalCoverage(sources)
// 三类缺口都拦：缺一行、多一行、申请超出批准，都是同一批写错。
const blocking: readonly NotificationApprovalGap[] = coverage.gaps

console.log(provenance())
console.log(formatApprovalCoverage(coverage))
for (const line of formatApprovalGaps(coverage)) console.log(`  ${line}`)

if (blocking.length > 0) {
  console.error(`\n[check:notification-approval] ${blocking.length} 处缺口：批准值没搬齐之前不许删平台兜底。`)
  process.exit(1)
}
console.log('\n[check:notification-approval] 每一条声明都带着自己的批准：0 缺口。')
