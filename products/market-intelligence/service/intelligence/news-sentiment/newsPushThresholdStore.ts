import { copyFileSync, existsSync, readFileSync } from 'node:fs'

import { writeFileAtomicallySync } from '@platform/storage/jsonFileStorage'

import { DEFAULT_NEWS_PUSH_THRESHOLD, type NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'

/**
 * 「舆情提醒 · 强度门槛」的配置存储（读者 2026-11-07 提：弱 / 中 / 强，选哪档就是该档以上都推）。
 *
 * 三条规矩，和「日历事件提醒」那份存储同一套：
 * - **「从没配过」与「读失败」是两件事**（2026-11-09 修）：文件不存在＝从没配过，用默认（中）；
 *   文件在、但读不出来＝读失败。读失败时 `read()` 仍回默认，让设置页和判定不至于打不开，
 *   **但 `write()` 一律拒绝这次保存并抛错**（界面落「这次没存上」），**绝不用默认值覆盖原文件**。
 *   修之前这里把两者混成一句「回默认」，于是读坏的阈值被下一次保存顺手改成「中」——读者的推送
 *   频率变了而他察觉不到（要对比设置页才发现）。
 * - **判坏之前先留档**：坏文件按 `.corrupt-<时间戳>` 原样留一份再抛；**留档失败就 fail-closed**
 *   （不写、不覆盖），与平台 `notificationJsonStorage` 那份口径一致；
 * - **写只接受三档之一**，非法值保持原值，不静默替换成一个看着合理的档；
 * - **字段清单只在这里**：`StoredShape` 与 `normalize` 是这份文件的全部字段。以后要加字段，
 *   同一笔把它登记进 `StoredShape`、`normalize`、`write` 三处，并补一条
 *   「写 → 换一个新的 store 实例读同一个文件 → 值还在」的用例。
 *   2026-11-07 通知设置那次的教训就是这个：字段没进归一化，写进去读回来就没了，而且不报错。
 *
 * ---
 * **「新字段要进归一化白名单」这条规矩分两种，别照字面套**（Chief 2026-11-07 定）：
 *
 * - **平台设置字段**（`NotificationRuntimeSettings`、`AppSettings` 这类）→ 进平台自己的归一化，
 *   并配「写 → 重建 → 读回」的用例；
 * - **产品设置字段**（就是本文件这种，例如推送强度门槛）→ **进产品自己的存储**，
 *   **同样要那条 round-trip 用例**，并做到「读坏回默认、写只收合法值」。
 *
 * 为什么不把产品字段塞进平台归一化：那份白名单的含义是「**平台认识的字段**」。把一个产品的
 * 阈值放进去，等于让平台认识「舆情强度」这个产品概念——平台不认产品词是从第一天守的边界
 * （删掉 `products/<id>` 之后平台还得是一个能用的通用桌面应用）。所以不是「少做了一步」，
 * 而是这一步本来就不该在平台里做。
 */
export const NEWS_PUSH_THRESHOLDS = ['low', 'medium', 'high'] as const satisfies readonly NewsSentimentTierThreshold[]

/** 默认「中」＝这条功能上线以来的行为；实测代价见需求（强约 5 条/天、中约 15 条/天、弱约 50 条/天）。 */
export { DEFAULT_NEWS_PUSH_THRESHOLD } from '../../../contracts/newsSentimentTiers'

export type NewsPushThresholdSettings = Readonly<{
  pushThreshold: NewsSentimentTierThreshold
}>

/** 一次读取的三种结果：真的读到了 / 从没配过 / 文件在但读不出来。 */
export type NewsPushThresholdReadState =
  | Readonly<{ state: 'ready'; settings: NewsPushThresholdSettings }>
  | Readonly<{ state: 'never-configured' }>
  | Readonly<{ state: 'unreadable'; reason: 'read-failed' | 'not-json' | 'not-an-object' }>

export type NewsPushThresholdStore = Readonly<{
  /** 给判定与界面用的值：读失败时回默认（中），不抛——但**这个值不许拿去覆盖文件**。 */
  read: () => NewsPushThresholdSettings
  /** 三种结果分开报；`write` 靠它决定要不要拒绝保存。 */
  readState: () => NewsPushThresholdReadState
  write: (patch: Readonly<{ pushThreshold?: unknown }>) => NewsPushThresholdSettings
}>

type StoredShape = Partial<{
  pushThreshold: unknown
}>

export function isNewsPushThreshold(value: unknown): value is NewsSentimentTierThreshold {
  return typeof value === 'string' && (NEWS_PUSH_THRESHOLDS as readonly string[]).includes(value)
}

function normalize(stored: StoredShape): NewsPushThresholdSettings {
  return {
    pushThreshold: isNewsPushThreshold(stored.pushThreshold) ? stored.pushThreshold : DEFAULT_NEWS_PUSH_THRESHOLD
  }
}

export function createNewsPushThresholdStore(filePath: string): NewsPushThresholdStore {
  const readState = (): NewsPushThresholdReadState => {
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch (error) {
      // 只有「文件不存在」算从没配过；锁住、权限不足、磁盘读错都是读失败。
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return { state: 'never-configured' }
      return { state: 'unreadable', reason: 'read-failed' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return { state: 'unreadable', reason: 'not-json' }
    }
    // 解析得出来但不是一份对象（数组 / 字符串 / null）：形状我们不认识，按读失败处理，
    // 免得把一份别人的文件整份换成 `{"pushThreshold":…}`。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: 'unreadable', reason: 'not-an-object' }
    }
    return { state: 'ready', settings: normalize(parsed as StoredShape) }
  }

  const read = (): NewsPushThresholdSettings => {
    const current = readState()
    // 读失败回默认（中）：判定与设置页都靠这个值继续工作。但**写路径不读这个函数**，
    // 否则下一次保存就把「读不到」写成「中」了。
    return current.state === 'ready' ? current.settings : normalize({})
  }

  return {
    read,
    readState,
    write(patch) {
      const current = readState()
      if (current.state === 'unreadable') {
        quarantineCorruptThresholdFile(filePath)
        throw new Error(`news-push-threshold-unreadable:${current.reason}`)
      }
      const base = current.state === 'ready' ? current.settings : normalize({})
      const next: NewsPushThresholdSettings = {
        pushThreshold: isNewsPushThreshold(patch.pushThreshold) ? patch.pushThreshold : base.pushThreshold
      }
      // 先写临时文件再 rename：写到一半被杀掉也不会留下半份 JSON，从而不会把这份文件
      // 变成「读失败」而挡住之后所有保存。
      writeFileAtomicallySync(filePath, JSON.stringify(next))
      return next
    }
  }
}

/**
 * 坏文件原样留一份 `.corrupt-<时间戳>`（与平台 `notificationJsonStorage` 同一口径）。
 * **失败就直接抛**：留不了档就不许动原文件，宁可这次保存失败。
 */
function quarantineCorruptThresholdFile(filePath: string): void {
  const stamp = Date.now()
  let target = `${filePath}.corrupt-${stamp}`
  for (let attempt = 1; existsSync(target); attempt += 1) target = `${filePath}.corrupt-${stamp}-${attempt}`
  copyFileSync(filePath, target)
}
