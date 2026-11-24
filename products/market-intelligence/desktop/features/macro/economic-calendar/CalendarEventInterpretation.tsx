import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
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
 * - 失败只显示一句原因 + 一个按钮，**不自动重试**（自动重试会在后台反复烧模型调用）；
 * - 低档与未分级由服务侧返回 `not-applicable`，这里什么都不画。
 */
export type CalendarInterpretationClient = Readonly<{
  readEventInterpretation: (input: { eventKey: string; locale: 'zh-CN' | 'en-US' }) => Promise<MacroCalendarInterpretationView>
  requestEventInterpretation: (input: { eventKey: string; locale: 'zh-CN' | 'en-US' }) => Promise<MacroCalendarInterpretationView>
}>

type State = MacroCalendarInterpretationView | { state: 'loading' }

/**
 * **StrictMode 单飞**：渲染器就是 `React.StrictMode`，effect 挂载双跑；`active` 只挡 setState、
 * 不挡请求，所以「打开一条没解读过的事件」在 dev 下会请求两次。按 (eventKey, locale) 记住在飞的
 * 那一次，第二个 effect 直接复用它——这是成本红线，不是体验优化。
 *
 * 重开（卸载再挂载）与 StrictMode 的第二次 effect 走的是**同一条路径**：第二次挂载命中在飞表。
 * StrictMode 的双调用是 React dev 构建的行为，与测试用的 DOM 实现无关（happy-dom 下一样会双跑）。
 */
const inFlightRequests = new Map<string, Promise<MacroCalendarInterpretationView>>()

function requestOnce(
  key: string,
  run: () => Promise<MacroCalendarInterpretationView>
): Promise<MacroCalendarInterpretationView> {
  const pending = inFlightRequests.get(key)
  if (pending !== undefined) return pending
  const started = run().finally(() => { inFlightRequests.delete(key) })
  inFlightRequests.set(key, started)
  return started
}

export function CalendarEventInterpretation({ eventKey, text, client }: {
  eventKey: string
  text: EconomicCalendarText
  client: CalendarInterpretationClient
}): ReactElement | null {
  const language = useShellLanguage()
  const formatTime = useShellTimeFormat()
  const [interpretation, setInterpretation] = useState<State>({ state: 'absent' })
  const { readEventInterpretation, requestEventInterpretation } = client
  /** 重试路径也要 unmount 守卫：读路径有 `active`，重试没有，卸载后仍会 setState。 */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /**
   * 读与生成**各 catch 各的**：本地读失败不是「模型没回答」，我们根本没问过模型。
   * 两档各落各的码，界面也就各给一句、各给一个按钮（界面设计 2026-11-25 第三条）。
   */
  const run = useCallback(async (alive: () => boolean): Promise<void> => {
    let read: MacroCalendarInterpretationView
    try {
      read = await readEventInterpretation({ eventKey, locale: language })
    } catch {
      if (alive()) setInterpretation({ state: 'failed', failureCode: 'read-failed' })
      return
    }
    if (!alive()) return
    if (read.state !== 'absent') { setInterpretation(read); return }
    // 没有才生成：这一份数据（实际值/预期/前值）还没被解读过。
    setInterpretation({ state: 'loading' })
    try {
      const requested = await requestOnce(`${eventKey}|${language}`, () => requestEventInterpretation({ eventKey, locale: language }))
      if (alive()) setInterpretation(requested)
    } catch {
      if (alive()) setInterpretation({ state: 'failed', failureCode: 'provider-error' })
    }
  }, [eventKey, language, readEventInterpretation, requestEventInterpretation])

  useEffect(() => {
    let active = true
    // 防御：换一条事件时先清空。宿主用 `key` 兜着，但去掉 key 就会先闪上一条的正文。
    setInterpretation({ state: 'loading' })
    void run(() => active)
    return () => { active = false }
  }, [run])

  /**
   * 重试按失败的**来源**分：读失败重读一次（本地读取，不花钱；读回来真有那一份就直接显示，
   * 只有读成功且确实还没有解读时才走和重新打开事件同一条生成路径，不多问一次模型）；
   * 生成失败才再问模型。一个档位只出一个按钮——并排两个会让读者以为它们干得不一样。
   */
  const retry = (failureCode: string): void => {
    setInterpretation({ state: 'loading' })
    if (failureCode === 'read-failed') { void run(() => mounted.current); return }
    void requestEventInterpretation({ eventKey, locale: language })
      .then((requested) => { if (mounted.current) setInterpretation(requested) })
      .catch(() => { if (mounted.current) setInterpretation({ state: 'failed', failureCode: 'provider-error' }) })
  }

  if (interpretation.state === 'loading') return <LoadingState label={text.interpretation.loading} layout="inline" size="sm" />
  if (interpretation.state === 'ready') {
    return <section className="mi-calendar-interpretation" data-calendar-interpretation aria-live="off">
      <h3>{text.interpretation.title}</h3>
      <p data-interpretation-text>{interpretation.text}</p>
      {/* 生成时刻与依据范围是这段文字的一部分：没有它们，模型文字与固定说明就分不开了。 */}
      <p className="mi-calendar-interpretation__meta" data-interpretation-meta>
        {metaLine(text, interpretation.evidenceScope, formatTime(interpretation.generatedAt, 'minute'))}
      </p>
    </section>
  }
  if (interpretation.state === 'failed') {
    const readFailed = interpretation.failureCode === 'read-failed'
    return <div className="mi-calendar-interpretation__failed" data-calendar-interpretation-failed>
      <p className="mi-calendar-interpretation__failure">
        {(text.interpretation.failure as Record<string, string>)[interpretation.failureCode] ?? text.interpretation.unavailable}
      </p>
      <Button size="small" onClick={() => retry(interpretation.failureCode)}>
        {readFailed ? text.interpretation.retryRead : text.interpretation.retry}
      </Button>
    </div>
  }
  // `absent` / `not-applicable`：这一条不该有解读，整块不出现。
  return null
}

/**
 * 时刻那一行。三态各说各的：
 * - 空依据（`[]`）**仍留时刻**、不画「依据」——时刻正是读者判断这段新旧、区分模型文字与固定说明的凭据；
 * - 认识的项 join 起来；服务端多给了新 scope 就丢掉，不把原样字符串糊给读者；
 * - 一项都不认识写兜底句。空数组不许拿兜底句顶：那是「没有」，替它编一个依据就成了「读不懂」。
 */
function metaLine(text: EconomicCalendarText, scope: readonly string[], time: string): string {
  if (scope.length === 0) return text.interpretation.metaTime.replace('{time}', time)
  const labels = text.interpretation.scope as Record<string, string>
  const known = scope
    .filter((entry) => Object.prototype.hasOwnProperty.call(labels, entry))
    .map((entry) => labels[entry]!)
  return text.interpretation.meta.replace('{time}', time)
    .replace('{scope}', known.length === 0 ? text.interpretation.basisFallback : known.join(text.details.hierarchySeparator))
}
