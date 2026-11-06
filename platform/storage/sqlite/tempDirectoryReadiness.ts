/**
 * 「系统临时目录已确认可写」这一个布尔量，**零 import**。
 *
 * 单独成文件的唯一理由：它要被三类调用方读，而其中一类是**渲染层测试的共享 setup**。
 * 早先把标志放在 `openSqliteDatabase` 里，setup 一 import 就把 `node:sqlite` 拖进了 happy-dom，
 * 于是所有渲染层测试在收集阶段就挂（`Cannot bundle built-in module "node:sqlite"`），
 * 一条断言都没跑。**形状对了不等于位置对了**：闸门要留在开库入口，标志要留在没有副作用的地方。
 *
 * 生产者只有一个：装配根在 `ensureWritableTempDirectory` 成功之后调 `markTempDirectoryVerified()`。
 * 消费者是 `openSqliteDatabase`（没标记就拒开）与测试 setup（测试环境统一标记）。
 */
/**
 * The flag lives on `globalThis`, not in this module's scope.
 *
 * Under `tsx` the same file can be loaded twice — a package alias and a relative path resolve to
 * two module URLs — and then the marker writes to one copy while the database opener reads the
 * other. That is exactly how the seed script failed with "temporary directory not verified" after
 * marking it successfully. One process, one flag: the symbol is the single owner, whoever imported
 * which copy.
 */
const VERIFIED = Symbol.for('macrobay.storage.tempDirectoryVerified')

type ReadinessGlobal = typeof globalThis & { [VERIFIED]?: boolean }

/** 由装配根在探针成功后调用；测试与脚本在自建可写目录后调用。 */
export function markTempDirectoryVerified(): void {
  (globalThis as ReadinessGlobal)[VERIFIED] = true
}

/** `openSqliteDatabase` 用它决定是否放行；单测用它断言初始状态。 */
export function isTempDirectoryVerified(): boolean {
  return (globalThis as ReadinessGlobal)[VERIFIED] === true
}
