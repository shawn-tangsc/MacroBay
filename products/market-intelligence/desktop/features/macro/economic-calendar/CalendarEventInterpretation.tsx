import { useEffect, useState, type ReactElement } from 'react'
import { Button } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { MacroCalendarInterpretationView } from '../../../../contracts/macro/economicCalendarQueryContracts'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * 事件详情里的「AI 解读」块（R36 #34 第二半）。
 *
 * 与固定说明是**两块、两个节点**：说明是我们写的、逐次一字不差；解读是模型写的、带生成时刻与
 * 依据范围。两者不许互相顶替——把解读塞进说明那块，或者反过来，都是这条需求的红线。
 *
 * 加载与生成都在这块里：
 * - 打开时先读；**没有**（这一份数据还没生成过）才请求生成一次；
 * - 失败只显示一句原因 + 重试键，**不自动重试**（自动重试会在后台反复烧模型调用）；
 * - 低档与未分级由服务侧返回 `not-applicable`，这里什么都不画。
 */
export type CalendarInterpretationClient = Readonly<{
  readEventInterpretation: (input: { eventKey: string; locale: 'zh-CN' | 'en-US' }) => Promise<MacroCalendarInterpretationView>
  requestEventInterpretation: (input: { eventKey: string; locale: 'zh-CN' | 'en-US' }) => Promise<MacroCalendarInterpretationView>
}>

type State = MacroCalendarInterpretationView | { state: 'loading' }

export function CalendarEventInterpretation({ eventKey, text, client }: {
  eventKey: string
  text: EconomicCalendarText
  client: CalendarInterpretationClient
}): ReactElement | null {
  const language = useShellLanguage()
  const formatTime = useShellTimeFormat()
  const [interpretation, setInterpretation] = useState<State>({ state: 'absent' })
  const { readEventInterpretation, requestEventInterpretation } = client

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      try {
        const read = await readEventInterpretation({ eventKey, locale: language })
        if (!active) return
        if (read.state !== 'absent') { setInterpretation(read); return }
        // 没有才生成：这一份数据（实际值/预期/前值）还没被解读过。
        setInterpretation({ state: 'loading' })
        const requested = await requestEventInterpretation({ eventKey, locale: language })
        if (active) setInterpretation(requested)
      } catch {
        if (active) setInterpretation({ state: 'failed', failureCode: 'provider-error' })
      }
    }
    void load()
    return () => { active = false }
  }, [eventKey, language, readEventInterpretation, requestEventInterpretation])

  const retry = (): void => {
    setInterpretation({ state: 'loading' })
    void requestEventInterpretation({ eventKey, locale: language })
      .then((requested) => setInterpretation(requested))
      .catch(() => setInterpretation({ state: 'failed', failureCode: 'provider-error' }))
  }

  if (interpretation.state === 'loading') return <LoadingState label={text.interpretation.generating} layout="inline" size="sm" />
  if (interpretation.state === 'ready') {
    return <section className="mi-calendar-interpretation" data-calendar-interpretation>
      <h3>{text.interpretation.title}</h3>
      <p data-interpretation-text>{interpretation.text}</p>
      {/* 生成时刻与依据范围是这段文字的一部分：没有它们，模型文字与固定说明就分不开了。 */}
      <p className="mi-calendar-interpretation__meta" data-interpretation-meta>
        {text.interpretation.generatedAt.replace('{time}', formatTime(interpretation.generatedAt, 'minute'))}
        {' · '}
        {text.interpretation.basis.replace('{scope}', interpretation.evidenceScope
          .map((scope) => (text.interpretation.scope as Record<string, string>)[scope] ?? scope)
          .join(text.details.hierarchySeparator))}
      </p>
    </section>
  }
  if (interpretation.state === 'failed') {
    return <div data-calendar-interpretation-failed>
      <p className="mi-economic-calendar__comparison-rule">
        {(text.interpretation.failure as Record<string, string>)[interpretation.failureCode] ?? text.interpretation.unavailable}
      </p>
      <Button size="small" onClick={retry}>{text.interpretation.retry}</Button>
    </div>
  }
  // `absent` / `not-applicable`：这一条不该有解读，整块不出现。
  return null
}