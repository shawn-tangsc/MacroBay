#!/usr/bin/env node
/**
 * 发布作业的**唯一实现**：把 `dist/` 里的产物挂到 GitHub Release，或者只校验、把要跑的命令打出来。
 *
 * 为什么从 `release.yml` 里搬出来：0.4.2 的发布红在「作业读到的东西它自己有没有」——那条 shell
 * 去仓库里找 `<version>.release-body.md`，而发布作业只下载产物、不检出仓库，于是在一个没有
 * `docs/` 的目录里报 `missing release body` 退 1。嵌在 YAML 里的实现只能等真标签才发现这类错；
 * 搬进脚本之后，临时目录造一份 `dist/` 就能跑（`--self-test` 连产物都不用准备）。
 *
 * 用法：
 *   node scripts/release/publish-release.mts --dist dist --tag v0.4.3              # 真发布
 *   node scripts/release/publish-release.mts --dist dist --tag v0.4.3 --dry-run    # 只校验 + 打印
 *   node scripts/release/publish-release.mts --self-test                           # 造临时 dist 自检
 *
 * 边界（由 `publish-release.test.mts` 守着）：
 * - **只读 `--dist` 指向的目录**，不读仓库里的任何文件（发布作业从不保证有 checkout）；
 * - 少一个必需产物就**报名字**退 1，不做一个缺件的 Release；
 * - 重跑只换产物、**不动正文**——正文由人在 Release 页手写（用户 2026-11-10 定）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 一次完整发布必须带上的产物；少一件就是缺件的 Release，宁可不发。 */
export const REQUIRED_ASSETS = [
  'MacroBay-arm64.dmg',
  'MacroBay-x64.dmg',
  'MacroBay-x64-setup.exe',
  'latest-mac.yml',
  'latest.yml'
] as const

/** 发布作业会上传的产物：三个安装器、它们的 blockmap，以及两套自动更新清单。 */
const ASSET_PATTERN = /^(?:[^/]+\.(?:dmg|exe|blockmap)|latest(?:-[a-z0-9]+)?\.ya?ml)$/u

export interface PublishPlan {
  readonly tag: string
  readonly version: string
  readonly distDir: string
  readonly assets: readonly string[]
}

/**
 * `download-artifact` 用 `merge-multiple` 把三个作业的产物摊平在 `dist/` 顶层。
 * 只收顶层普通文件：出现子目录说明下载方式变了，那不是这份计划能猜的事。
 */
export function collectAssets(distDir: string): string[] {
  if (!existsSync(distDir)) throw new Error(`dist directory does not exist: ${distDir}`)
  if (!statSync(distDir).isDirectory()) throw new Error(`dist is not a directory: ${distDir}`)
  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ASSET_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right))
}

/** 校验通过才给计划；任何一件必需产物不在，就带着名字抛出来。 */
export function planPublish({ distDir, tag }: { distDir: string; tag: string }): PublishPlan {
  const version = tag.startsWith('v') ? tag.slice(1) : ''
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`invalid release tag: ${tag} (expected vX.Y.Z)`)
  }
  const assets = collectAssets(distDir)
  const missing = REQUIRED_ASSETS.filter((name) => !assets.includes(name))
  if (missing.length > 0) {
    throw new Error(
      `missing release asset${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} — ` +
        `the build jobs did not upload ${missing.length > 1 ? 'them' : 'it'} into ${distDir}`
    )
  }
  return { tag, version, distDir, assets }
}

/** 要执行的 gh 命令。拆成 argv 数组，调用方自己决定是执行还是只打印。 */
export function releaseCommands(plan: PublishPlan, { exists }: { exists: boolean }): string[][] {
  if (exists) return [['gh', 'release', 'upload', plan.tag, '--clobber', ...plan.assets]]
  return [
    [
      'gh',
      'release',
      'create',
      plan.tag,
      '--title',
      `MacroBay ${plan.version}`,
      '--notes-file',
      '/dev/null',
      '--verify-tag',
      ...plan.assets
    ]
  ]
}

function quote(argument: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/u.test(argument) ? argument : `'${argument.replaceAll("'", `'\\''`)}'`
}

export function renderPlan(plan: PublishPlan, { exists }: { exists: boolean }): string {
  const lines = [`publish plan for ${plan.tag}: ${plan.assets.length} asset(s) in ${plan.distDir}`]
  for (const name of plan.assets) lines.push(`  ${name}`)
  lines.push(
    exists
      ? `release ${plan.tag} already exists — would replace its assets and leave the body alone`
      : `release ${plan.tag} does not exist yet — would create it with an empty body (written by hand later)`
  )
  for (const argv of releaseCommands(plan, { exists })) lines.push(`  ${argv.map(quote).join(' ')}`)
  return lines.join('\n')
}

/** `gh release view` 的退出码就是「有没有这个 Release」，不需要额外查 API。 */
export function releaseExists(tag: string): boolean {
  return spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' }).status === 0
}

/** 真发布：只有计划通过之后才会走到这里。 */
export function runPublish(plan: PublishPlan, { exists }: { exists: boolean }): string {
  for (const argv of releaseCommands(plan, { exists })) {
    const [command, ...args] = argv
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`command failed (exit ${result.status}): ${argv.join(' ')}`)
  }
  const url = spawnSync('gh', ['release', 'view', plan.tag, '--json', 'url', '-q', '.url'], {
    encoding: 'utf8'
  })
  if (url.status !== 0) throw new Error(`command failed (exit ${url.status}): gh release view ${plan.tag}`)
  return url.stdout.trim()
}

/**
 * 不真发布的自检：在临时目录造一份完整的 `dist/`，跑一遍计划；再删掉一件，确认**报得出名字**。
 * 两个方向都过才算通过——只证明「齐的时候能过」的检查，抓不到 0.4.2 那种缺件。
 */
export function selfTest(): string[] {
  const distDir = mkdtempSync(join(tmpdir(), 'publish-release-self-test-'))
  try {
    for (const name of REQUIRED_ASSETS) writeFileSync(join(distDir, name), '')
    writeFileSync(join(distDir, 'MacroBay-arm64.dmg.blockmap'), '')
    const plan = planPublish({ distDir, tag: 'v0.0.0' })

    rmSync(join(distDir, 'MacroBay-x64.dmg'))
    let reported: string | null = null
    try {
      planPublish({ distDir, tag: 'v0.0.0' })
    } catch (error) {
      reported = error instanceof Error ? error.message : String(error)
    }
    if (reported === null || !reported.includes('missing release asset: MacroBay-x64.dmg')) {
      throw new Error(`self-test: a missing asset was not reported by name (got: ${reported ?? 'no error'})`)
    }
    return [
      `publish self-test OK: ${plan.assets.length} asset(s) planned for ${plan.tag}, ` +
        'and a missing asset is reported by name'
    ]
  } finally {
    rmSync(distDir, { recursive: true, force: true })
  }
}

const USAGE = `usage:
  publish-release.mts --dist <dir> --tag vX.Y.Z [--dry-run] [--exists]
  publish-release.mts --self-test`

function option(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value\n${USAGE}`)
  return value
}

function main(argv: readonly string[]): number {
  if (argv.includes('--self-test')) {
    for (const line of selfTest()) console.log(line)
    return 0
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  const distDir = option(argv, '--dist')
  const tag = option(argv, '--tag')
  if (distDir === null || tag === null) throw new Error(USAGE)

  const plan = planPublish({ distDir, tag })
  const exists = argv.includes('--exists')
  if (argv.includes('--dry-run')) {
    console.log(renderPlan(plan, { exists }))
    console.log('dry run: no Release was created or changed')
    return 0
  }
  const alreadyExists = releaseExists(tag)
  console.log(renderPlan(plan, { exists: alreadyExists }))
  console.log(`release URL: ${runPublish(plan, { exists: alreadyExists })}`)
  return 0
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href
if (invokedPath !== null && import.meta.url === invokedPath) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
