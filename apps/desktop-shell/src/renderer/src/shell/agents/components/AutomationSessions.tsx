import { useMemo, useState } from 'react'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellClock, formatShellDay } from '@platform/ui/time/shellTimeFormat'

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
 */
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

  const todayCount = groups.find((group) => group.key === todayKey)?.sessions.length ?? 0
  const dayLabel = (key: string): string => {
    if (key === todayKey) return text.today
    const yesterdayKey = formatShellDay(new Date(Date.parse(`${todayKey}T00:00:00Z`) - 86_400_000).toISOString(), 'UTC')
    if (key === yesterdayKey) return text.yesterday
    return key.slice(5)
  }

  return (
    <section aria-label={text.title} className="agent-auto-sessions">
      <button
        aria-controls="agent-auto-sessions-body"
        aria-expanded={expanded}
        className="agent-auto-sessions__head"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="agent-auto-sessions__title">{text.title}</span>
        <span className="agent-auto-sessions__meta">{text.collapsedMeta(todayCount, sessions.length)}</span>
      </button>
      {expanded ? <div id="agent-auto-sessions-body">
        {groups.map((group) => {
          const open = openDays.has(group.key)
          return (
            <div className="agent-auto-sessions__day" key={group.key}>
              <button
                aria-expanded={open}
                className="agent-auto-sessions__day-head"
                onClick={() => setOpenDays((current) => {
                  const next = new Set(current)
                  if (next.has(group.key)) next.delete(group.key)
                  else next.add(group.key)
                  return next
                })}
                type="button"
              >
                <span>{dayLabel(group.key)}</span>
                <small>{group.sessions.length}</small>
              </button>
              {open ? group.sessions.map((session) => (
                <button
                  className="agent-auto-sessions__item"
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  type="button"
                >
                  <span className="agent-auto-sessions__item-title">{session.name}</span>
                  <span className="agent-auto-sessions__item-meta">
                    {formatShellClock(session.createdAt, { timeZone }) ?? session.createdAt}
                  </span>
                </button>
              )) : null}
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
      </div> : null}
    </section>
  )
}
