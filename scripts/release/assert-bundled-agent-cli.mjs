#!/usr/bin/env node
/**
 * 包内智能体 CLI 的架构断言（发布作业用）。
 *
 * 为什么需要：`pnpm dist:mac` 打出来的 app 里带一个平台原生的 `claude` 可执行文件，它由 pnpm 按
 * **宿主架构**安装。构建机装错架构时，包照样能打出来、`hdiutil verify` 照样 VALID——直到用户机器上
 * 智能体起不来。2026-11-09 做 Intel 包时就说过要加一条「产物里 CLI 的架构必须等于目标架构」的通用
 * 断言，但一直只有 x64 作业有；arm64 作业只断言了「runner 是 arm64」。2026-11-19 本机构建时包里同时
 * 出现 arm64 与 x64 两个 `claude`，正好说明这条不能靠 runner 架构代替。
 *
 * 判据：**包里每一个 `claude-agent-sdk-darwin-…/claude` 都必须是目标架构**，且必须存在一份
 * `darwin-<目标架构>` 的；否则退 1 并指出是哪个文件、实际是什么架构。
 *
 * 用法：
 *   node scripts/release/assert-bundled-agent-cli.mjs --app release/mac-arm64/MacroBay.app --arch arm64
 *   node scripts/release/assert-bundled-agent-cli.mjs --app release/mac/MacroBay.app --arch x64
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Mach-O 的 cputype → 我们关心的两种目标架构。 */
const CPU_TYPE_X86_64 = 0x01000007
const CPU_TYPE_ARM64 = 0x0100000c

/**
 * 读 Mach-O 头判断架构。**不调 `file`**：作业里少一个外部依赖，测试里也能用几字节的假文件跑红绿。
 * 覆盖：64 位小端（`0xfeedfacf`）、32 位小端（`0xfeedface`）、fat/universal（`0xcafebabe` 大端头）。
 */
export function machOArch(buffer) {
  if (buffer.length < 8) return 'unknown'
  const magic = buffer.readUInt32LE(0)
  // fat/universal 的头是**大端**写的，所以同一个 0xcafebabe 要按 BE 读。
  const magicBigEndian = buffer.readUInt32BE(0)

  if (magic === 0xfeedfacf || magic === 0xfeedface) {
    const cpuType = buffer.readUInt32LE(4)
    return cpuTypeToArch(cpuType) ?? `unknown(cputype=0x${cpuType.toString(16)})`
  }

  if (magicBigEndian === 0xcafebabe) {
    const count = buffer.readUInt32BE(4)
    if (count <= 0 || count > 32) return 'unknown'
    const arches = []
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * 20
      if (buffer.length < offset + 4) return 'unknown'
      arches.push(cpuTypeToArch(buffer.readUInt32BE(offset)))
    }
    if (arches.every((arch) => arch === 'x64')) return 'x64'
    if (arches.every((arch) => arch === 'arm64')) return 'arm64'
    return 'universal'
  }

  return 'unknown'
}

function cpuTypeToArch(cpuType) {
  if (cpuType === CPU_TYPE_X86_64) return 'x64'
  if (cpuType === CPU_TYPE_ARM64) return 'arm64'
  return null
}

/** 递归找所有 `claude-agent-sdk-darwin-…/claude`；`claude-agent-sdk-darwin-<arch>` 这一段决定它该是什么架构。 */
export function findBundledClis(resourcesDir) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.isFile() || basename(path) !== 'claude') continue
      const marker = /claude-agent-sdk-darwin-([a-z0-9]+)/u.exec(path)
      if (marker === null) continue
      found.push({ path, vendorArch: marker[1] })
    }
  }
  walk(resourcesDir)
  return found.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * 断言：每个包内 CLI 都是目标架构，且存在目标架构的那一份。
 * 返回问题列表（空数组 = 通过）；不抛异常，调用方决定打印与退出码。
 */
export function bundledCliProblems({ appPath, arch }) {
  const resourcesDir = join(appPath, 'Contents', 'Resources')
  try {
    statSync(resourcesDir)
  } catch {
    return [`cannot read ${resourcesDir} — is the app bundle there?`]
  }

  const clis = findBundledClis(resourcesDir)
  if (clis.length === 0) {
    return [`no claude-agent-sdk-darwin-*/claude found under ${resourcesDir}`]
  }

  const problems = []
  for (const cli of clis) {
    const actual = machOArch(readFileSync(cli.path))
    if (actual !== arch && actual !== 'universal') {
      problems.push(
        `${relative(appPath, cli.path)}: ${actual}, expected ${arch} (the package is ${arch}, but its agent CLI is not)`
      )
    }
  }
  if (!clis.some((cli) => cli.vendorArch === arch)) {
    problems.push(`no darwin-${arch} agent CLI in the package; found ${clis.map((cli) => cli.vendorArch).join(', ')}`)
  }
  return problems
}

function option(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? null : value
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const appPath = option(process.argv.slice(2), '--app')
  const arch = option(process.argv.slice(2), '--arch')
  if (appPath === null || (arch !== 'arm64' && arch !== 'x64')) {
    console.error('usage: assert-bundled-agent-cli.mjs --app <MacroBay.app> --arch arm64|x64')
    process.exit(2)
  }

  const clis = (() => {
    try {
      return findBundledClis(join(appPath, 'Contents', 'Resources'))
    } catch {
      return []
    }
  })()
  for (const cli of clis) {
    console.log(`${relative(appPath, cli.path)}: ${machOArch(readFileSync(cli.path))} (vendor says darwin-${cli.vendorArch})`)
  }

  const problems = bundledCliProblems({ appPath, arch })
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`)
    process.exit(1)
  }
  console.log(`OK the bundled agent CLI matches ${arch}`)
}
