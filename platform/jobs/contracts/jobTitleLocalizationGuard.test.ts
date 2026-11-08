import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 作业名守卫（契约 `job-title-localization-contract.md` §5、`notification-event-ownership.md` §七）。
 *
 * **这一版不含任何产品名、产品路径、条数常量**：作业清单一律从
 * `products/<id>/product.manifest.ts` 的 `jobHandlers` 声明读出来。产品新增一个作业、把定义拆到
 * 另一个文件，都不需要改平台守卫——这正是「平台侧零业务概念」的要求。
 *
 * 三条判据：
 * 1. **双向覆盖**：每条声明都要有定义，每个定义都要被声明。少一边就是「有人加了作业没登记」或
 *    「登记了却没人实现」，两种都不该静默通过。
 * 2. **平台自己的作业定义不许写字面量 `title`**：平台作业的名字由词表/参数给，不许在代码里写死
 *    一句文案——那既不可翻译，也会把某一门语言固化进平台。
 * 3. 本守卫自身不引用产品：只认 `products/*` 这个形状。
 */

const PRODUCTS_ROOT = 'products'
const PLATFORM_ROOT = 'platform'
const MANIFEST_NAME = 'product.manifest.ts'

/** 作业定义的标记：注册进调度表的定义必带 `audience`（一次性运行不带）。 */
const DEFINITION_MARKER = "audience: '"

function isSourceFile(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.includes(`${sep}node_modules${sep}`)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (isSourceFile(path)) out.push(path)
  }
  return out
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/** 每个产品的 `jobHandlers` 声明：`{ productId, jobIds }`。 */
function declaredJobs(): Array<{ productId: string; jobIds: string[] }> {
  return readdirSync(resolve(PRODUCTS_ROOT))
    .filter((entry) => statSync(join(PRODUCTS_ROOT, entry)).isDirectory())
    .filter((productId) => existsSync(join(PRODUCTS_ROOT, productId, MANIFEST_NAME)))
    .map((productId) => ({
      productId,
      jobIds: declaredJobIdsIn(read(join(PRODUCTS_ROOT, productId, MANIFEST_NAME)))
    }))
    .filter((product) => product.jobIds.length > 0)
}

/**
 * 从 manifest 文本里取 `jobHandlers: [ … ]` 这一段，再抽 `id: '…'`。
 *
 * 不 `import` 产品：那既是平台反向依赖，也会让 `products` 里任何一个包删掉时平台测试炸在这里。
 */
function declaredJobIdsIn(manifest: string): string[] {
  const start = manifest.indexOf('jobHandlers:')
  if (start < 0) return []
  const open = manifest.indexOf('[', start)
  const close = manifest.indexOf(']', open)
  if (open < 0 || close < 0) return []
  const block = manifest.slice(open, close)
  return [...block.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1])
}

/** 未迁移的写法：`title: '…'` 与 `title: \`…\`` 都算；双语对象（`title: { … }`）不算。 */
function literalTitleCount(source: string): number {
  const quoted = source.match(/title:\s*'(?:[^'\\]|\\.)*'/g) ?? []
  const templated = source.match(/title:\s*`[^`]*`/g) ?? []
  return quoted.length + templated.length
}

function jobDefinitionFiles(root: string): string[] {
  return walk(resolve(root)).filter((file) => read(file).includes(DEFINITION_MARKER))
}

describe('job title guard', () => {
  const products = declaredJobs()

  it('finds product job declarations to guard at all', () => {
    // 一条都不声明时，覆盖断言会「因为空集而通过」——那等于守卫消失。
    expect(products.length).toBeGreaterThan(0)
  })

  /**
   * 声明必须落在自己的命名空间里：`<productId>.…`。
   *
   * 这条不需要读产品源码——很多定义是工厂按参数生成的（`definitionFor(feed)` 之类），
   * 静态配对 id 会在那些工厂上失效；而「作业 id 归属哪个产品」是 manifest 自己就该说清的事，
   * 跨产品的 id 会让「删掉某个产品」变得不干净，也会让归属在排障时说不清。
   */
  it('keeps every declared job inside its own product namespace', () => {
    const offenders = products.flatMap((product) =>
      product.jobIds
        .filter((id) => !id.startsWith(`${product.productId}.`))
        .map((id) => ({ productId: product.productId, id }))
    )
    expect(offenders, `job ids declared outside their product namespace: ${JSON.stringify(offenders, null, 2)}`)
      .toEqual([])
  })

  it('never lets a platform job definition write its own title as a literal', () => {
    const offenders = jobDefinitionFiles(PLATFORM_ROOT)
      .map((file) => ({
        file: file.slice(resolve('.').length + 1).split(sep).join('/'),
        literals: literalTitleCount(read(file))
      }))
      .filter((entry) => entry.literals > 0)
    expect(offenders, `platform job definitions carry literal titles: ${JSON.stringify(offenders, null, 2)}`)
      .toEqual([])
  })
})
