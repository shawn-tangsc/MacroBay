import type { NewsSentimentEntity } from '../schema/newsSentiment'

/**
 * 跨媒体归并键：**由实体集与 UTC 日桶确定性合成**，不让模型直接写键。
 *
 * 为什么不让模型写：同一个事件两次调用必然给出两种措辞（`us-midterm-elections` /
 * `midterms-2026`），直接当键时跨媒体归并**永远失败而且不报错**——我们以为在去重，其实一条都
 * 没并上。让模型只交「实体集」这个素材、由本函数合成键，就有了可判定性：同一份实体集跑两次
 * 必须得到同一个键。
 *
 * 为什么连边要「共享 ≥2 个实体，且至少 1 个是具体主体（人 / 机构 / 法案）」：只要求「至少 1 个
 * 不是资产」是不够的——两家交易所各自被盗的两条新闻会共享 `hack`（事件）与 `bitcoin`（资产），
 * 于是被并成一条。必须共享一个**能指名道姓的主体**才算同一件事：`binance` 与 `mercado bitcoin`
 * 不是，而同一场选举里共享的 `democrats` 是。
 *
 * 为什么用 UTC 日桶而不是滚动窗口：滚动窗口依赖处理顺序，重跑一次结果就变；这里的键必须能
 * 复跑。代价是跨零点的事件会被拆成两个键（漏并、多推一条）——按「宁可漏并，不可误并」接受。
 */
export type StoryKeyCandidate = {
  itemId: string
  publishedAt: string
  entities: readonly NewsSentimentEntity[]
  /** 已经落库的键。同一簇里先到的那条把键定下来，后来的报道沿用它，不再另起一个。 */
  storyKey?: string
}

/**
 * 同一天（UTC）内、同一簇的事件共用一个键。
 *
 * 键的锚点不是「发布时间最早」，而是**这条簇里第一个被评分出键的报道**：后到的报道沿用已落库的
 * 键。原因是一轮评分按最新优先处理——先评出来的是较晚发布的那条，如果锚在「发布时间最早」，
 * 紧接着被评的较早报道会另起一个键，同一件事就有了两个键（且先落库的那个永远改不回来）。
 * 先到先定、后来者沿用，才保证「一簇一个键」。
 *
 * 没有实体就返回 `undefined`：没有键就不推，这是契约里写死的开关，不许用标题或 URL 顶替。
 */
export function storyKeyOf(input: {
  itemId: string
  publishedAt: string
  entities: readonly NewsSentimentEntity[]
  peers?: readonly StoryKeyCandidate[]
}): string | undefined {
  if (input.entities.length === 0) return undefined
  const bucket = utcDayBucket(input.publishedAt)
  if (!bucket) return undefined

  const members: StoryKeyCandidate[] = [{ itemId: input.itemId, publishedAt: input.publishedAt, entities: input.entities }]
  for (const peer of input.peers ?? []) {
    if (peer.itemId === input.itemId) continue
    if (peer.entities.length === 0) continue
    if (utcDayBucket(peer.publishedAt) !== bucket) continue
    members.push(peer)
  }
  members.sort(byPublishedAt)

  const cluster = clusterOf(members, input.itemId)
  if (cluster.length === 0) return undefined
  // 已经落库的键优先：取簇里发布时间最早的那个已有键，保证后来者并入而不是另起。
  const existing = cluster
    .filter((member) => member.storyKey)
    .sort(byPublishedAt)
    .at(0)
  if (existing?.storyKey) return existing.storyKey
  return `story:${bucket}:${input.itemId}`
}

/** 与 `storyKey` 同源的连边判断，供用例与后续合并逻辑复用，避免第二份相似度实现。 */
export function sharesStoryEvent(
  left: readonly NewsSentimentEntity[],
  right: readonly NewsSentimentEntity[]
): boolean {
  const leftByName = new Set(left.map((entity) => `${entity.kind}:${entity.name}`))
  let shared = 0
  let sharedActor = 0
  for (const entity of right) {
    if (!leftByName.has(`${entity.kind}:${entity.name}`)) continue
    shared += 1
    // 事件词与币种都不指名：`hack` + `bitcoin` 能凑够两个，却是两家交易所的两件事。
    if (entity.kind === 'person' || entity.kind === 'org' || entity.kind === 'bill') sharedActor += 1
  }
  return shared >= 2 && sharedActor >= 1
}

/** `publishedAt` 的 UTC 日；不是合法时刻时返回 `undefined`（宁可不推，不猜日期）。 */
export function utcDayBucket(publishedAt: string): string | undefined {
  const parsed = Date.parse(publishedAt)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString().slice(0, 10)
}

function byPublishedAt(left: StoryKeyCandidate, right: StoryKeyCandidate): number {
  if (left.publishedAt !== right.publishedAt) return left.publishedAt < right.publishedAt ? -1 : 1
  if (left.itemId === right.itemId) return 0
  return left.itemId < right.itemId ? -1 : 1
}

/**
 * 连通分量：边是「共享 ≥2 个实体且含至少一个具体主体」。分量与边的添加顺序无关，
 * 因此同一批实体集怎么打乱都得到同一个簇。
 */
function clusterOf(members: readonly StoryKeyCandidate[], itemId: string): StoryKeyCandidate[] {
  const parent = members.map((_, index) => index)
  const find = (index: number): number => {
    let cursor = index
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]!]!
      cursor = parent[cursor]!
    }
    return cursor
  }
  const union = (left: number, right: number): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }
  for (let left = 0; left < members.length; left += 1) {
    for (let right = left + 1; right < members.length; right += 1) {
      if (sharesStoryEvent(members[left]!.entities, members[right]!.entities)) union(left, right)
    }
  }
  const selfRoot = find(members.findIndex((member) => member.itemId === itemId))
  return members.filter((_, index) => find(index) === selfRoot)
}
