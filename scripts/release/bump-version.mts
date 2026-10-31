/**
 * 一处改版本号：`pnpm release:bump 0.2.1`。
 *
 * 版本号散落在七处，手改必漏（漏了 `check-release-version` 会在打标签后才红）。
 * 这个脚本按固定清单改写，改完打印命中数量；任何一处没命中就失败，而不是静默跳过。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const VERSION = /^\d+\.\d+\.\d+$/u

type Target = Readonly<{ path: string; pattern: RegExp; replace: (match: string, next: string) => string }>

const targets: readonly Target[] = [
  { path: 'package.json', pattern: /("version":\s*")(\d+\.\d+\.\d+)(")/u, replace: (_m, next) => `"version": "${next}"` },
  { path: 'products/market-intelligence/product.manifest.ts', pattern: /(version:\s*')(\d+\.\d+\.\d+)(')/u, replace: (_m, next) => `version: '${next}'` },
  { path: 'README.md', pattern: /(alpha\*\* \(`)(\d+\.\d+\.\d+)(`\))/u, replace: (_m, next) => `alpha** (\`${next}\`)` },
  { path: 'README.zh-CN.md', pattern: /(\*\*alpha\*\*（`)(\d+\.\d+\.\d+)(`）)/u, replace: (_m, next) => `**alpha**（\`${next}\`）` },
  { path: 'docs/reference/status-and-limitations.md', pattern: /(MacroBay is at `)(\d+\.\d+\.\d+)(`)/u, replace: (_m, next) => `MacroBay is at \`${next}\`` },
  { path: 'docs/reference/status-and-limitations.md', pattern: /(The `)(\d+\.\d+\.\d+)(` release)/u, replace: (_m, next) => `The \`${next}\` release` },
  { path: 'docs/reference/status-and-limitations.zh-CN.md', pattern: /(MacroBay 当前版本是 `)(\d+\.\d+\.\d+)(`)/u, replace: (_m, next) => `MacroBay 当前版本是 \`${next}\`` },
  { path: 'docs/reference/status-and-limitations.zh-CN.md', pattern: /(`)(\d+\.\d+\.\d+)(` 不承诺内部 API)/u, replace: (_m, next) => `\`${next}\` 不承诺内部 API` },
  // The bug report form asks which release a reader installed. A stale hint sends them to the wrong
  // tag, and it is the last place that still names one concrete version.
  { path: '.github/ISSUE_TEMPLATE/bug_report.yml', pattern: /(placeholder: ")(\d+\.\d+\.\d+)(")/u, replace: (_m, next) => `placeholder: "${next}"` }
]

const requested = process.argv[2]
if (!requested || !VERSION.test(requested)) {
  process.stderr.write('usage: pnpm release:bump <major.minor.patch>\n')
  process.exit(2)
}

let failures = 0
for (const target of targets) {
  const source = readFileSync(target.path, 'utf8')
  const pattern = new RegExp(target.pattern.source, target.pattern.flags.includes('g') ? target.pattern.flags : `${target.pattern.flags}g`)
  let hits = 0
  const next = source.replace(pattern, (...args: unknown[]) => {
    hits += 1
    return target.replace(String(args[0]), requested)
  })
  if (hits === 0) {
    process.stderr.write(`✗ ${target.path}: pattern not found (${target.pattern})\n`)
    failures += 1
    continue
  }
  writeFileSync(target.path, next)
  process.stdout.write(`✓ ${target.path} (${hits})\n`)
}

process.stdout.write(failures === 0 ? `\nversion is now ${requested}\n` : `\n${failures} file(s) not updated\n`)
process.exit(failures === 0 ? 0 : 1)
