/**
 * 示例模式的常驻横幅与入口。
 *
 * 横幅不可关闭：它是「这张截图不是实时数据」的唯一保证。入口只在门户出现一次，
 * 用克制的按钮，不做营销块。
 */

import { ArrowRight, FlaskConical, LogOut } from 'lucide-react'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

export type SampleModeText = Readonly<{
  entry: Readonly<{ cta: string; hint: string; missing: string }>
  banner: Readonly<{
    title: string
    replay: string
    /** 含 `{time}` 占位。 */
    scenario: string
    noUpdate: string
    exit: string
    connect: string
  }>
  watermark: string
}>

export function SampleModeEntry({ text, busy, missing, onEnter }: {
  text: SampleModeText
  busy: boolean
  missing: boolean
  onEnter: () => void
}): React.ReactElement {
  return (
    <div className="mi-sample-entry">
      <button className="mi-sample-entry__action" disabled={busy} onClick={onEnter} type="button">
        <FlaskConical aria-hidden="true" size={14} strokeWidth={1.8} />
        {text.entry.cta}
      </button>
      <span className="mi-sample-entry__hint">{missing ? text.entry.missing : text.entry.hint}</span>
    </div>
  )
}

export function SampleModeBanner({ text, scenarioNow, busy, onExit, onConnect }: {
  text: SampleModeText
  scenarioNow?: string
  busy: boolean
  onExit: () => void
  onConnect: () => void
}): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const scenario = scenarioNow
    ? text.banner.scenario.replace('{time}', formatTime(scenarioNow, 'minute'))
    : ''
  return (
    <div className="mi-sample-banner" role="status">
      <FlaskConical aria-hidden="true" className="mi-sample-banner__icon" size={15} strokeWidth={1.8} />
      <div className="mi-sample-banner__copy">
        <span className="mi-sample-banner__title">{text.banner.title}</span>
        <span className="mi-sample-banner__meta">{text.banner.replay}</span>
        {scenario ? <span className="mi-sample-banner__meta">{scenario}</span> : null}
        <span className="mi-sample-banner__meta">{text.banner.noUpdate}</span>
      </div>
      <div className="mi-sample-banner__actions">
        <button className="mi-sample-banner__button" disabled={busy} onClick={onExit} type="button">
          <LogOut aria-hidden="true" size={13} strokeWidth={1.8} />
          {text.banner.exit}
        </button>
        <button className="mi-sample-banner__button is-primary" disabled={busy} onClick={onConnect} type="button">
          {text.banner.connect}
          <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
