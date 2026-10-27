/**
 * 示例数据的体检与验收（设计 156 §3.3 / §3.4）。
 *
 * 用法：`pnpm demo:verify [dir]`，默认校验 `products/market-intelligence/demo/scenarios`。
 *
 * 没有场景时退出 0 —— 仓库里暂时没有示例数据是正常状态；有任何一项不合规就退出 1，
 * 因为一份「看起来能跑但数字对不上」的示例数据比没有更糟。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const ANY_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/gu
const LOCALES = ['common', 'zh-CN', 'en-US'] as const
const MAX_FILE_BYTES = 64 * 1024
const WARN_TOTAL_BYTES = 800 * 1024
const FAIL_TOTAL_BYTES = 2 * 1024 * 1024

type Finding = Readonly<{ level: 'error' | 'warn'; message: string }>

function isInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function findScenarios(root: string): string[] {
  const found: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry === 'raw') continue
    const directory = join(root, entry)
    if (!statSync(directory).isDirectory()) continue
    try {
      statSync(join(directory, 'scenario.json'))
      found.push(directory)
    } catch {
      // 不是场景目录：忽略。
    }
  }
  return found
}

function readJson(path: string, findings: Finding[]): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    findings.push({ level: 'error', message: `${path}: 不是合法 JSON（${String(error).slice(0, 80)}）` })
    return undefined
  }
}

function checkScenario(directory: string): Finding[] {
  const findings: Finding[] = []
  const id = basename(directory)
  const meta = readJson(join(directory, 'scenario.json'), findings) as Record<string, unknown> | undefined
  if (!meta) return findings

  if (meta.schemaVersion !== 1) findings.push({ level: 'error', message: `${id}: schemaVersion 必须是 1` })
  if (meta.id !== id) findings.push({ level: 'error', message: `${id}: id 与目录名不一致` })
  const title = meta.title as Record<string, unknown> | undefined
  if (!title || typeof title['zh-CN'] !== 'string' || typeof title['en-US'] !== 'string') {
    findings.push({ level: 'error', message: `${id}: title 需要 zh-CN 与 en-US` })
  }
  const scenarioNow = meta.scenarioNow
  const recordedAt = meta.recordedAt
  if (!isInstant(scenarioNow)) findings.push({ level: 'error', message: `${id}: scenarioNow 不是合法瞬时` })
  if (!isInstant(recordedAt)) findings.push({ level: 'error', message: `${id}: recordedAt 不是合法瞬时` })
  const window = meta.window as Record<string, unknown> | undefined
  if (!window || !isInstant(window.from) || !isInstant(window.to)) {
    findings.push({ level: 'error', message: `${id}: window.from / window.to 不合法` })
    return findings
  }
  if (Date.parse(window.from) > Date.parse(window.to)) findings.push({ level: 'error', message: `${id}: window.from 晚于 window.to` })
  if (isInstant(scenarioNow) && Date.parse(window.to) > Date.parse(scenarioNow)) {
    findings.push({ level: 'error', message: `${id}: window.to 晚于 scenarioNow` })
  }

  const surfaces = readJson(join(directory, 'surfaces.json'), findings)
  const surfaceList = Array.isArray(surfaces) ? surfaces.filter((entry): entry is string => typeof entry === 'string') : []
  if (!Array.isArray(surfaces) || surfaceList.length !== surfaces.length) {
    findings.push({ level: 'error', message: `${id}: surfaces.json 必须是字符串数组` })
  }

  const fixtures = new Map<string, string>()
  for (const locale of LOCALES) {
    const localeDirectory = join(directory, 'responses', locale)
    let files: string[]
    try {
      files = readdirSync(localeDirectory)
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const path = join(localeDirectory, file)
      const method = file.slice(0, -'.json'.length)
      const bytes = statSync(path).size
      if (bytes > MAX_FILE_BYTES) {
        findings.push({ level: 'error', message: `${id}/${locale}/${file}: ${bytes} 字节，超过 64 KB` })
      }
      const envelope = readJson(path, findings) as Record<string, unknown> | undefined
      if (!envelope) continue
      if (envelope.schemaVersion !== 1) findings.push({ level: 'error', message: `${id}/${locale}/${file}: schemaVersion 必须是 1` })
      if (envelope.method !== method) findings.push({ level: 'error', message: `${id}/${locale}/${file}: method 与文件名不一致` })
      if (envelope.effect !== 'read') findings.push({ level: 'error', message: `${id}/${locale}/${file}: effect 只能是 read` })
      const hasPayload = Object.hasOwn(envelope, 'payload')
      const hasByRequest = envelope.byRequest !== undefined
      if (hasPayload === hasByRequest) findings.push({ level: 'error', message: `${id}/${locale}/${file}: payload 与 byRequest 必须恰有其一` })
      if (hasByRequest && typeof envelope.byRequestKey !== 'string') {
        findings.push({ level: 'error', message: `${id}/${locale}/${file}: byRequest 需要 byRequestKey` })
      }
      scanPayload(envelope, `${id}/${locale}/${file}`, scenarioNow, findings)
      fixtures.set(method, `${locale}/${file}`)
    }
  }

  for (const surface of surfaceList) {
    if (!fixtures.has(surface)) findings.push({ level: 'error', message: `${id}: surfaces 声明了 ${surface}，但没有 fixture` })
  }
  return findings
}

/** 卫生检查：不许出现 URL、凭据痕迹、以及晚于场景时钟的时间。 */
function scanPayload(value: unknown, where: string, scenarioNow: unknown, findings: Finding[]): void {
  const text = JSON.stringify(value)
  if (/https?:\/\//iu.test(text)) findings.push({ level: 'error', message: `${where}: 含有 URL` })
  if (/"hasCredential"\s*:\s*true/u.test(text)) findings.push({ level: 'error', message: `${where}: 声称存有凭据` })
  if (/\b(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|[a-f0-9]{32,})\b/u.test(text)) {
    findings.push({ level: 'error', message: `${where}: 含有疑似密钥的字符串` })
  }
  if (!isInstant(scenarioNow)) return
  const limit = Date.parse(scenarioNow)
  for (const match of text.match(ANY_INSTANT) ?? []) {
    const parsed = Date.parse(match)
    if (Number.isFinite(parsed) && parsed > limit) findings.push({ level: 'error', message: `${where}: 时间 ${match} 晚于场景时钟` })
  }
}

function directoryBytes(root: string): number {
  let total = 0
  for (const entry of readdirSync(root)) {
    if (entry === 'raw') continue
    const path = join(root, entry)
    const stats = statSync(path)
    total += stats.isDirectory() ? directoryBytes(path) : stats.size
  }
  return total
}

const root = resolve(process.argv[2] ?? 'products/market-intelligence/demo/scenarios')
const scenarios = findScenarios(root)
if (scenarios.length === 0) {
  process.stdout.write('no sample scenarios found — nothing to verify.\n')
  process.exit(0)
}

const findings: Finding[] = []
for (const scenario of scenarios) findings.push(...checkScenario(scenario))

const totalBytes = directoryBytes(root)
if (totalBytes > FAIL_TOTAL_BYTES) {
  findings.push({ level: 'error', message: `示例数据总量 ${(totalBytes / 1024).toFixed(0)} KB，超过 2 MB` })
} else if (totalBytes > WARN_TOTAL_BYTES) {
  findings.push({ level: 'warn', message: `示例数据总量 ${(totalBytes / 1024).toFixed(0)} KB，超过 800 KB 预算` })
}

const errors = findings.filter((finding) => finding.level === 'error')
for (const finding of findings) process.stdout.write(`${finding.level === 'error' ? '✗' : '!'} ${finding.message}\n`)
process.stdout.write(`\n${scenarios.length} scenario(s), ${(totalBytes / 1024).toFixed(0)} KB, ${errors.length} error(s)\n`)
process.exit(errors.length > 0 ? 1 : 0)
