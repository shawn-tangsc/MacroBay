/**
 * 示例模式的常驻横幅。
 *
 * 它不可关闭：读者在任何时候都该知道「这张图不是实时数据」。退出与接入放在右侧，
 * 退出后立即回到真实模式。
 */

import { Button } from 'antd'
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
        {/* 图标留在原位、不换成 `icon=`：两颗按钮的图形一前一后，`icon=` 会把「接入」那颗的箭头
            挪到文字前面，那是可见的顺序变化。 */}
        <Button className="mi-sample-banner__button" disabled={busy} onClick={onExit} size="small" type="default">
          <LogOut aria-hidden="true" size={13} strokeWidth={1.8} />
          {text.exit}
        </Button>
        <Button className="mi-sample-banner__button is-primary" disabled={busy} onClick={onConnect} size="small" type="default">
          {text.connect}
          <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
        </Button>
      </div>
    </div>
  )
}
