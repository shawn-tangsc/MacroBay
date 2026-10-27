/**
 * 示例模式的常驻横幅。
 *
 * 它不可关闭：读者在任何时候都该知道「这张图不是实时数据」。退出与接入放在右侧，
 * 退出后立即回到真实模式。
 */

import { ArrowRight, FlaskConical, LogOut } from 'lucide-react'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

export type SampleModeBannerText = Readonly<{
  title: string
  replay: string
  /** 含 `{time}` 占位。 */
  scenario: string
  noUpdate: string
  exit: string
  connect: string
}>

export function SampleModeBanner({ text, scenarioNow, busy, onExit, onConnect }: {
  text: SampleModeBannerText
  scenarioNow?: string
  busy: boolean
  onExit: () => void
  onConnect: () => void
}): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const scenario = scenarioNow ? text.scenario.replace('{time}', formatTime(scenarioNow, 'minute')) : ''
  return (
    <div className="mi-sample-banner" role="status">
      <FlaskConical aria-hidden="true" className="mi-sample-banner__icon" size={15} strokeWidth={1.8} />
      <div className="mi-sample-banner__copy">
        <span className="mi-sample-banner__title">{text.title}</span>
        <span className="mi-sample-banner__meta">{text.replay}</span>
        {scenario ? <span className="mi-sample-banner__meta">{scenario}</span> : null}
        <span className="mi-sample-banner__meta">{text.noUpdate}</span>
      </div>
      <div className="mi-sample-banner__actions">
        <button className="mi-sample-banner__button" disabled={busy} onClick={onExit} type="button">
          <LogOut aria-hidden="true" size={13} strokeWidth={1.8} />
          {text.exit}
        </button>
        <button className="mi-sample-banner__button is-primary" disabled={busy} onClick={onConnect} type="button">
          {text.connect}
          <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
