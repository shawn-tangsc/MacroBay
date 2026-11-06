import {
  NEWS_SENTIMENT_LIMITS,
  type NewsSentimentEntity,
  type NewsSentimentEntityKind
} from '../schema/newsSentiment'

/**
 * 模型给的实体集是**不可信输入**：这里只做规范化与校验，不做任何解释。
 *
 * 规范化必须在这里收口，因为归并键是「实体名相等」——同一个名字两种写法（`SEC` / `sec`、
 * `U.S. SEC` / `us sec`）在键上就是两个实体，同一条新闻会被判成两件事。同一事件被两家媒体报道
 * 时，模型本来就可能给它两种写法，所以名字这项只能比「规范化之后是否相同」。
 */
const ENTITY_KINDS: readonly NewsSentimentEntityKind[] = ['person', 'org', 'bill', 'asset', 'event']

export type ParsedNewsSentimentEntities =
  | { ok: true; value: NewsSentimentEntity[] }
  | { ok: false; errorCode: 'news-model-invalid-output' }

/**
 * 缺字段按「没有实体」处理（规则兜底、或模型没给），**形状错了按输出违约处理**：
 * 少了 `entities` 只是拿不到归并键，而一个 `kind` 不在闭集里的实体集说明模型没按契约回答——
 * 那种回答不能拿来做判据，也不能悄悄降级成「没有实体」。
 */
export function parseNewsSentimentEntities(raw: unknown): ParsedNewsSentimentEntities {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw)) return invalid()
  const seen = new Map<string, NewsSentimentEntity>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid()
    const value = entry as Record<string, unknown>
    if (typeof value.name !== 'string' || typeof value.kind !== 'string') return invalid()
    if (!ENTITY_KINDS.includes(value.kind as NewsSentimentEntityKind)) return invalid()
    const name = normalizeEntityName(value.name)
    // 空名是噪音而不是违约：模型常给它一个没意义的占位，丢掉它比丢掉整条判断好。
    if (!name) continue
    const entity: NewsSentimentEntity = { name, kind: value.kind as NewsSentimentEntityKind }
    seen.set(`${entity.kind}:${entity.name}`, entity)
  }
  const sorted = [...seen.values()].sort(compareEntities)
  return {
    ok: true,
    // 超出上限说明模型把整句塞进来了。截断而不是整条拒收：判断本身仍然可用，只是键会变粗。
    value: sorted.slice(0, NEWS_SENTIMENT_LIMITS.entitiesPerItem)
  }
}

/** 小写、折叠空白、去掉首尾标点，并压掉内部重复空格。 */
export function normalizeEntityName(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[`"'“”‘’()\[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:;,./|]+|[\s\-–—:;,./|]+$/g, '')
    .trim()
    .slice(0, NEWS_SENTIMENT_LIMITS.entityNameChars)
}

function compareEntities(left: NewsSentimentEntity, right: NewsSentimentEntity): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1
  if (left.name === right.name) return 0
  return left.name < right.name ? -1 : 1
}

function invalid(): ParsedNewsSentimentEntities {
  return { ok: false, errorCode: 'news-model-invalid-output' }
}
