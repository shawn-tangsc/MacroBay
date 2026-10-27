/**
 * 示例场景的索引：把 `demo/scenarios/**` 下的 JSON 变成「按接口名查一份返回体」的表。
 *
 * 目录约定见 156 §4：`scenario.json` 是元数据，`surfaces.json` 是这版数据承诺覆盖的接口清单，
 * `responses/<locale>/<method>.json` 是 fixture。语言解析顺序：当前语言 → common → en-US。
 */

import {
  parseSampleModeFixture,
  parseSampleModeScenarioMeta,
  sampleModeResponsePath,
  sampleModeScenarioPath,
  type SampleModeFixture,
  type SampleModeLocale,
  type SampleModeScenarioMeta
} from './demoScenario'

export type SampleModeEntry = SampleModeFixture

export type SampleModeScenario = Readonly<{
  meta: SampleModeScenarioMeta
  surfaces: readonly string[]
  entries: ReadonlyMap<string, SampleModeEntry>
  problems: readonly string[]
}>

export type SampleModeCatalog = Readonly<{
  locale: SampleModeLocale
  scenarios: readonly SampleModeScenario[]
  problems: readonly string[]
}>

export type SampleModeFileMap = Readonly<Record<string, unknown>>

export type SampleModeCatalogInput = Readonly<{
  scenarioFiles: SampleModeFileMap
  surfacesFiles: SampleModeFileMap
  responseFiles: SampleModeFileMap
  locale: SampleModeLocale
}>

function unwrapModule(value: unknown): unknown {
  if (value && typeof value === 'object' && 'default' in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).default
  }
  return value
}

function readSurfaces(value: unknown): string[] | undefined {
  const parsed = unwrapModule(value)
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) return undefined
  return parsed as string[]
}

/** 只保留这份数据真正能服务的接口；其余在 `problems` 里点名，加载不会因此中断。 */
export function buildSampleModeCatalog(input: SampleModeCatalogInput): SampleModeCatalog {
  const problems: string[] = []
  const scenarioIds = new Set<string>()
  for (const path of Object.keys(input.scenarioFiles)) {
    const parsed = sampleModeScenarioPath(path)
    if (parsed) scenarioIds.add(parsed.scenarioId)
  }

  const byLocale = new Map<string, Map<string, SampleModeEntry>>()
  for (const path of Object.keys(input.responseFiles)) {
    const parsed = sampleModeResponsePath(path)
    if (!parsed) continue
    const fixture = parseSampleModeFixture(unwrapModule(input.responseFiles[path]), parsed.name)
    if (!fixture) {
      problems.push(`${parsed.scenarioId}:invalid-fixture:${parsed.name}`)
      continue
    }
    const scenarioBucket = byLocale.get(parsed.scenarioId) ?? new Map<string, SampleModeEntry>()
    const bucketKey = `${parsed.locale}:${fixture.method}`
    scenarioBucket.set(bucketKey, fixture)
    byLocale.set(parsed.scenarioId, scenarioBucket)
  }

  const scenarios: SampleModeScenario[] = []
  for (const scenarioId of scenarioIds) {
    const metaPath = Object.keys(input.scenarioFiles).find((path) => sampleModeScenarioPath(path)?.scenarioId === scenarioId)
    const meta = metaPath
      ? parseSampleModeScenarioMeta(unwrapModule(input.scenarioFiles[metaPath]), scenarioId)
      : undefined
    if (!meta) {
      problems.push(`${scenarioId}:invalid-scenario`)
      continue
    }
    const surfacesPath = Object.keys(input.surfacesFiles).find((path) => sampleModeScenarioPath(path)?.scenarioId === scenarioId)
    const surfaces = surfacesPath ? readSurfaces(input.surfacesFiles[surfacesPath]) : undefined
    if (!surfaces) problems.push(`${scenarioId}:invalid-surfaces`)

    // common 打底，当前语言覆盖：同一个接口只留一份，避免「两个文件谁生效」变成运行时谜题。
    const bucket = byLocale.get(scenarioId) ?? new Map<string, SampleModeEntry>()
    const entries = new Map<string, SampleModeEntry>()
    for (const locale of ['common', 'en-US', input.locale] as const) {
      for (const [key, entry] of bucket) {
        if (!key.startsWith(`${locale}:`)) continue
        entries.set(entry.method, entry)
      }
    }
    scenarios.push(Object.freeze({
      meta,
      surfaces: Object.freeze(surfaces ?? []),
      entries,
      problems: Object.freeze([])
    }))
  }

  scenarios.sort((left, right) => left.meta.id.localeCompare(right.meta.id))
  return Object.freeze({ locale: input.locale, scenarios: Object.freeze(scenarios), problems: Object.freeze(problems) })
}

/**
 * 构建期索引。glob 必须写成字面量，Vite 才能在主进程构建时展开它——
 * 因此这个函数是唯一接触文件系统的入口，测试用 `buildSampleModeCatalog` 注入文件表。
 */
export function loadSampleModeCatalog(locale: SampleModeLocale): SampleModeCatalog {
  const scenarioFiles = import.meta.glob('../../demo/scenarios/*/scenario.json', { eager: true })
  const surfacesFiles = import.meta.glob('../../demo/scenarios/*/surfaces.json', { eager: true })
  const responseFiles = import.meta.glob('../../demo/scenarios/*/responses/*/*.json', { eager: true })
  return buildSampleModeCatalog({ scenarioFiles, surfacesFiles, responseFiles, locale })
}
