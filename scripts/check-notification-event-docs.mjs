#!/usr/bin/env node
/**
 * 文档与代码的通知事件 id 对照（本地、手动跑，不进 verify）。
 *
 * 为什么不在 verify 链里：`docs-private` 是 gitignore 的，CI 上没有这些文件；
 * 放进去只会在 CI 上永远跳过，制造一个「看起来有检查」的假象。
 *
 * 做法：代码侧只认两个权威来源——
 *   · 平台批准表 `platform/notifications/contracts/notificationEventPolicy.ts` 的键；
 *   · 各产品 `products/<id>/product.manifest.ts` 里 `notificationEvent('<id>'` 的声明。
 * 文档侧扫「规范类」文档（见 DOC_EXCLUDES），把形如 `<命名空间>.<段>.<段>` 的 token 抓出来，
 * 命名空间只认 `platform` 与各产品 id（否则会把普通路径、包名也算进来）。
 * 文档提到而代码没声明的 id → 报出来并返回非零。
 *
 * 三条边界，都是被真实误报逼出来的：
 *   1. **消息总线的话题也算「代码里声明过」**：产品 manifest 的 `eventTopics` 与通知事件
 *      共用同一套命名空间，第一版把它们全当成「文档提到但代码没有」，一次报出十几个。
 *   2. **历史文档不扫**：编号设计日志、归档、复盘、台账修订记录里提到的旧 id 是当时的记录，
 *      改它就是改写历史（同命名清扫那条裁定）。只扫「规范类」。
 *   3. **有意提及未登记的 id 时，同一行写一个机器可读标记**：
 *      `retired-event-id`（已撤回）、`proposed-event-id`（提案/本版不登记）、`not-an-event-id`
 *      （这不是通知事件 id，例如运行时拼出来的任务 run id）；中文「已撤回 / 撤回 / 提案 / 不登记 / 改名」
 *      也认，但标记优先——它不会因为一句话换了措辞就失效。
 *      放行是**逐行**的，不是逐文件的：同一篇文档里可以有「故意提及」和「漏改」两种行。
 *
 * 为什么这方向是安全的：抽取偏保守。别人用了别的写法声明事件时，这里会漏抽，
 * 结果是「多报」而不是「漏报」——宁可吵，不能安静。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const DOCS_ROOT = join(ROOT, 'docs-private')
const POLICY_FILE = join(ROOT, 'platform/notifications/contracts/notificationEventPolicy.ts')
const PRODUCTS_ROOT = join(ROOT, 'products')

const ID_PATTERN = /\b([a-z][a-z0-9-]*)\.([a-z0-9-]+\.)+[a-z0-9-]+\b/g

/** 规范类文档的目录白名单；历史/归档/复盘一律不扫（见文件头第 2 条）。 */
const DOC_INCLUDES = ['05-desktop', '10-development', 'marketing', 'iterations']

/** 即使在白名单目录里也要跳过的子树（编号设计日志属于历史记录）。 */
const DOC_EXCLUDES = ['09-implementation', 'archive', 'pitfalls', 'node_modules']

function readIfExists(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function walk(dir, suffix, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      walk(full, suffix, out)
    } else if (entry.name.endsWith(suffix)) {
      out.push(full)
    }
  }
  return out
}

function productIds() {
  try {
    return readdirSync(PRODUCTS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => readIfExists(join(PRODUCTS_ROOT, entry.name, 'product.manifest.ts')) !== undefined)
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 代码里声明的事件 id（平台批准表 + 各产品 manifest）。 */
function declaredIds() {
  const ids = new Set()

  const policy = readIfExists(POLICY_FILE)
  if (policy !== undefined) {
    for (const match of policy.matchAll(/'([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)'\s*:\s*\{/g)) ids.add(match[1])
  }

  for (const productId of productIds()) {
    const manifest = readIfExists(join(PRODUCTS_ROOT, productId, 'product.manifest.ts'))
    if (manifest === undefined) continue
    for (const match of manifest.matchAll(/notificationEvent\(\s*'([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)'/g)) ids.add(match[1])
    // 消息总线话题与通知事件共用命名空间：声明过的是别的机制，但不是「文档凭空提到」。
    for (const match of manifest.matchAll(/'(market-intelligence\.[a-z0-9.-]+)'/g)) ids.add(match[1])
  }

  return ids
}

function docFiles() {
  try {
    statSync(DOCS_ROOT)
  } catch {
    return undefined
  }
  const files = []
  for (const dir of DOC_INCLUDES) {
    const full = join(DOCS_ROOT, dir)
    try {
      statSync(full)
    } catch {
      continue
    }
    for (const file of walk(full, '.md')) files.push(file)
  }
  return files.filter((file) => {
    const rel = relative(DOCS_ROOT, file).split(sep).join('/')
    return !DOC_EXCLUDES.some((dir) => rel.includes(`/${dir}/`))
  })
}

const files = docFiles()
if (files === undefined) {
  console.log('check:event-doc-ids — skipped (docs-private 不存在)')
  process.exit(0)
}

const declared = declaredIds()
const namespaces = new Set(['platform', ...productIds()])

if (declared.size === 0) {
  console.log('check:event-doc-ids — skipped (没有抽到任何已声明事件 id；先看抽取规则是否失配)')
  process.exit(0)
}

const unknown = new Map()
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(ID_PATTERN)) {
      const id = match[0]
      if (!namespaces.has(match[1])) continue
      if (declared.has(id)) continue
      if (/retired-event-id|proposed-event-id|not-an-event-id|已撤回|撤回|提案|不登记|改名|renamed/i.test(lines[index])) continue
      const key = id
      if (!unknown.has(key)) unknown.set(key, [])
      unknown.get(key).push(`${relative(ROOT, file).split(sep).join('/')}:${index + 1}`)
    }
  }
}

if (unknown.size === 0) {
  console.log(`check:event-doc-ids — ok（${files.length} 篇文档，${declared.size} 个已声明事件 id，零处对不上）`)
  process.exit(0)
}

console.log(`check:event-doc-ids — ${unknown.size} 个 id 在文档里出现、代码里没有声明：`)
for (const [id, places] of [...unknown].sort()) {
  console.log(`  ${id}`)
  for (const place of places) console.log(`    ${place}`)
}
console.log('')
console.log('要么删掉文档里的这些说法，要么先回产品申请事件（编号不复用）。')
process.exit(1)
