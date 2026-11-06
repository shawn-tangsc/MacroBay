#!/usr/bin/env node
/**
 * 只读导出：把库里已评分的条目连同实体集、归并键、`why` 导出成夹具 JSON。
 *
 * 用途只有一个——把**一次真实运行**的产出原样钉成用例夹具。它不写库、不改产品代码，
 * 也不生成任何内容：库里没有实体就导不出来，这正是不许「人工编一个数糊过去」的意思。
 *
 * 用法（脚本里的 `@platform/...` 别名要经 tsx 解析，直接用 node 跑会 ERR_MODULE_NOT_FOUND）：
 *   pnpm exec tsx scripts/export-news-story-fixture.mts --db <news-sentiment.sqlite> \
 *     --state <pipeline-state.json> [--item item-rss:guid:…]… [--limit 40]
 *
 * 输出到 stdout，含出身信息（capturedAt / promptVersion / modelRef 集合 / itemIds），
 * 以及每条 itemId / publishedAt / title / entities / storyKey / why。
 */
import { readFileSync } from 'node:fs'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'
import { markTempDirectoryVerified } from '@platform/storage/sqlite/tempDirectoryReadiness'

type Row = Record<string, unknown>

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function args(name: string): string[] {
  const out: string[] = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}`) out.push(process.argv[index + 1] ?? '')
  }
  return out.filter(Boolean)
}

const dbPath = arg('db')
const statePath = arg('state')
if (!dbPath) {
  process.stderr.write('missing --db <news-sentiment.sqlite>\n')
  process.exit(1)
}
const wanted = new Set(args('item'))
const limit = Number(arg('limit') ?? 40)

// 临时目录闸门是给「应用启动时先探一次」用的，脚本里显式打开（同 seed 脚本的先例，
// 见 `openSqliteDatabase` 注释）。开库仍走统一入口：只读打开不改写文件，因此不切 journal 模式。
markTempDirectoryVerified()
const db = openSqliteDatabase(dbPath, { readOnly: true })
// 老库（schema v2）没有这三列。这里要说清「还没有真实产出」，而不是抛一个 SQLite 报错让人以为脚本坏了。
const columns = new Set(
  (db.prepare('pragma table_info(news_sentiment)').all() as Row[]).map((row) => String(row.name))
)
const missing = ['entities_json', 'story_key', 'why_text'].filter((column) => !columns.has(column))
if (missing.length > 0) {
  process.stderr.write(
    `schema is older than the entity fields (missing: ${missing.join(', ')}).\n` +
      'No real run has produced entities yet — start the app once on the new build, let a scoring pass finish, then export again.\n'
  )
  db.close()
  process.exit(2)
}

const rows = db
  .prepare(
    `select s.item_id, s.published_at, s.polarity, s.strength, s.confidence, s.entities_json,
            s.story_key, s.why_text, s.engine, s.prompt_version, s.model_ref, s.scored_at
       from news_sentiment s
       join (select item_id, max(scored_at) as scored_at from news_sentiment group by item_id) latest
         on latest.item_id = s.item_id and latest.scored_at = s.scored_at
      order by s.published_at desc
      limit ?`
  )
  .all(limit) as Row[]
db.close()

const titles = new Map<string, { title: string; sourceId: string; url?: string }>()
if (statePath) {
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as { items?: Row[] }
  for (const item of state.items ?? []) {
    titles.set(String(item.itemId), {
      title: String(item.title ?? ''),
      sourceId: String(item.sourceId ?? ''),
      ...(item.url ? { url: String(item.url) } : {})
    })
  }
}

const selected = rows.filter((row) => (wanted.size === 0 ? true : wanted.has(String(row.item_id))))
const entries = selected.map((row) => {
  const item = titles.get(String(row.item_id))
  return {
    itemId: String(row.item_id),
    publishedAt: String(row.published_at),
    ...(item ? { sourceId: item.sourceId, title: item.title, ...(item.url ? { url: item.url } : {}) } : {}),
    engine: String(row.engine),
    polarity: String(row.polarity),
    strength: Number(row.strength),
    confidence: Number(row.confidence),
    entities: parseEntities(row.entities_json),
    ...(row.story_key == null ? {} : { storyKey: String(row.story_key) }),
    ...(row.why_text == null ? {} : { why: String(row.why_text) })
  }
})

const withEntities = entries.filter((entry) => entry.entities.length > 0)
process.stdout.write(
  `${JSON.stringify(
    {
      note: 'Real run output. Pinned verbatim: do not hand-edit to make a test pass — a bad extraction is a finding, not a fixture bug.',
      capturedAt: new Date().toISOString(),
      source: { db: dbPath, ...(statePath ? { state: statePath } : {}) },
      rowCount: selected.length,
      rowsWithEntities: withEntities.length,
      promptVersions: [...new Set(selected.map((row) => String(row.prompt_version ?? '')))].filter(Boolean),
      modelRefs: [...new Set(selected.map((row) => String(row.model_ref ?? '')))].filter(Boolean),
      scoredAtRange: [
        selected.map((row) => String(row.scored_at)).sort()[0] ?? null,
        selected.map((row) => String(row.scored_at)).sort().at(-1) ?? null
      ],
      itemIds: entries.map((entry) => entry.itemId),
      entries
    },
    null,
    2
  )}\n`
)

function parseEntities(value: unknown): Array<{ name: string; kind: string }> {
  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is { name: string; kind: string } => Boolean(entry) && typeof entry.name === 'string' && typeof entry.kind === 'string')
      .map((entry) => ({ name: entry.name, kind: entry.kind }))
  } catch {
    return []
  }
}
