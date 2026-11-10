import { useMemo, useState } from 'react'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { displaySessionName } from '@platform/ai/agent-platform/schemas/sessionDisplayName'
import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellDay, formatShellTimeOfDay } from '@platform/ui/time/shellTimeFormat'

import { useAgentText } from '../agentTextProvider'
import './automationSessions.css'

/** Everything the caller already scoped to this agent; the block never widens the query itself. */
type AutomationSessionsProps = {
  sessions: readonly AgentSessionEntity[]
  onSelectSession: (sessionId: string) => void
}

/**
 * 自动会话：单独一块、默认收成一行、按天分节。
 *
 * 一天最多几十条自动会话，混进读者的列表两三天就不能用了。默认状态要回答「我聊过什么」，
 * 不是「机器今天干了什么」——所以这块默认只有一行摘要，展开才铺开。
 *
 * 分节按**显示时区**的日算（`formatShellDay`），不用 UTC 日：否则东八区的早晨会被分到前一天。
 *
 * 两层折叠，各管一件事，两个能力都要：
 * - 外层 `children` 模式 = 整块收起（头行是「自动会话」+ 共 N 条，展开区自己滚 320，头行不滚走）；
 * - 内层 `rows` 模式 = 每天一组、各自独立开合（今天默认开，其余默认收）。
 * 壳的两层都由 `CollapsibleGroup` 提供，块里不再自绘折叠头。
 *
 * 计数只说一次：块头给总计（「共 41 条」），日分组标题**只写日期**，不再重复「今天 21」。
 */
/**
 * 行尾该显示的时刻；名字里已经有这个时刻时返回 `null`（同一行不许出现两次时间）。
 *
 * 只用**墙钟时刻**、不带日期：日期由日分组标题表达（今天 / 昨天 / MM-DD），行内再带一次
 * 就是同一天说两遍；而且带日期的串（`11-09 20:45`）永远匹配不上名字里的写法（`2026/11/9 20:45`），
 * 「名字已带时刻就不再重复」的判定会失效。
 */
function rowClock(session: AgentSessionEntity, timeZone: string): string | null {
  const clock = formatShellTimeOfDay(session.createdAt, { timeZone })
  if (clock === null) return null
  return session.name.includes(clock) ? null : clock
}

/**
 * 壳的 `resolveText` 只被 `*Key` 用到。本块的标题、日期、会话名**全是已解析的原文**
 * （日期是从数据切出来的，会话名是运行时数据），一个键也不走——所以这里给同义回落，
 * 真有人误传键进来时看见的是键本身，而不是一句假翻译。
 */
const passthroughText = (key: string): string => key

export default function AutomationSessions({ sessions, onSelectSession }: AutomationSessionsProps): React.ReactElement | null {
  const t = useAgentText()
  const text = t.sidePanel.automationSessions
  const timeZone = useShellTimeZone()
  const [expanded, setExpanded] = useState(false)
  const todayKey = formatShellDay(new Date().toISOString(), timeZone) ?? ''
  // 今天默认开、过去的天默认收：最常见的翻法就是「今天机器干了什么」。
  const [openDays, setOpenDays] = useState<ReadonlySet<string>>(() => new Set(todayKey === '' ? [] : [todayKey]))

  const groups = useMemo(() => {
    const byDay = new Map<string, AgentSessionEntity[]>()
    for (const session of sessions) {
      const key = formatShellDay(session.createdAt, timeZone)
      // 时刻读不出来的会话不猜日期：宁可放不进任何一天，也不塞进「今天」。
      if (key === null) continue
      const bucket = byDay.get(key)
      if (bucket) bucket.push(session)
      else byDay.set(key, [session])
    }
    return [...byDay.entries()]
      .map(([key, entries]) => ({
        key,
        sessions: [...entries].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      }))
      .sort((left, right) => right.key.localeCompare(left.key))
  }, [sessions, timeZone])

  // 一条都没有时整块不出现：读者不该先去怀疑是不是没加载出来。
  if (sessions.length === 0) return null

  const dayLabel = (key: string): string => {
    if (key === todayKey) return text.today
    const yesterdayKey = formatShellDay(new Date(Date.parse(`${todayKey}T00:00:00Z`) - 86_400_000).toISOString(), 'UTC')
    if (key === yesterdayKey) return text.yesterday
    return key.slice(5)
  }

  const toggleDay = (key: string, open: boolean): void => {
    setOpenDays((current) => {
      const next = new Set(current)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }

  return (
    <section aria-label={text.title} className="agent-auto-sessions">
      {/*
        **本块不设自己的高度上限**：滚动交给侧栏唯一的滚动容器 `.agent-session-list`，展开区就是
        面板剩余的可视高度。这里若吃 `CollapsibleGroup` 默认的 320，就变成「小盒子自己滚、盒子下面
        一大片空白」，同一列两条滚动条（0.4.2 发布说明写明「整个侧栏只剩一个滚动条」）。
        代价：内容长时「自动会话」头行会随内容滚走——这是发布说明里已写明的取舍。
        内层每天一组同样不设上限，理由相同。
      */}
      <CollapsibleGroup
        maxBodyHeight={null}
        metaText={text.totalOnly(sessions.length)}
        onOpenChange={setExpanded}
        open={expanded}
        resolveText={passthroughText}
        titleText={text.title}
      >
        {groups.map((group) => {
          const rows = group.sessions.map((session) => {
            const clock = rowClock(session, timeZone)
            /*
              名字一律经 `displaySessionName`：库里的老行把运行 id 当名字存了下来，
              直接印 `session.name` 就是把 `mi-ar-<uuid>` 给读者看。名字读不出来时给中性文案，
              **绝不回落到 id**——宁可说「未命名会话」，也不印账本编号。

              同一行只出现一次时间：自动会话的名字里常常已经带了时刻（`2026/11/9 20:45 …`），
              行尾再印一遍就是两个时间；分组标题已经表达了日期，所以行尾只留时刻。
              这个判断留在调用方——组件不替调用方猜文案。
            */
            const label = displaySessionName(session) ?? t.sidePanel.unnamedSession
            return clock === null
              ? { key: session.id, labelText: label, onSelect: onSelectSession }
              : { key: session.id, labelText: label, metaText: clock, onSelect: onSelectSession }
          })

          return (
            /*
              每天一组外面包一层：块头在 12，日头与行内容都进到 24——**只进一层**。
              壳的缩进是「头行与行各自 12」，两层直接嵌会全停在 12、日头与行并排、看不出层级；
              在这里补一层 12 正好是 24，再往上叠就成 36（界面设计 2026-11-09 写死的判据）。
            */
            <div className="agent-auto-sessions__day" key={group.key}>
              <CollapsibleGroup
                // 外层已经给了滚动上限（320）：内层再套一个就成两条互相套着的滚动条。
                maxBodyHeight={null}
                onOpenChange={(open) => toggleDay(group.key, open)}
                open={openDays.has(group.key)}
                resolveText={passthroughText}
                rows={rows}
                titleText={dayLabel(group.key)}
              />
            </div>
          )
        })}
        {groups.length > 1 || !openDays.has(todayKey) ? (
          <button
            className="agent-auto-sessions__all"
            onClick={() => setOpenDays(new Set(groups.map((group) => group.key)))}
            type="button"
          >
            {text.showAll}
          </button>
        ) : null}
      </CollapsibleGroup>
    </section>
  )
}
