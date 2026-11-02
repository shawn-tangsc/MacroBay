import { Info } from 'lucide-react'

import type { AppSettings, AppSettingsPatch } from '@platform/settings/schema/appSettings'

import { platformText } from '../../../i18n/platformText'
import { VersionCheckRow } from '../version/VersionCheckRow'
import type { UpdateCheckClient } from '../version/updateCheckClient'

/**
 * 设置 → 关于我们。
 *
 * 只做三件事：**说清我装的是哪一版、有没有新版、去哪拿**。没有大图、没有营销语，
 * 与设置区其它页同一种密度（内容列 720，正文列 480）。
 *
 * 更新块**直接复用** `VersionCheckRow`（七态、文案、失败句都在里面，已签过）——
 * 同一组件换容器，不写第二套。链接块与更新说明分别在后续两步接上。
 */
export function AboutSettingsPage(props: {
  settings: AppSettings
  onUpdateSettings: (patch: AppSettingsPatch) => Promise<void>
  /** 产品名由宿主传入（`app.getName()`），它是个专有名词，不进词表。 */
  productName: string
  client?: UpdateCheckClient
}): React.ReactElement {
  const text = platformText[props.settings.language].about

  return (
    <section className="settings-detail-pane about-page">
      <header className="about-identity">
        <span className="about-mark" aria-hidden="true">
          <Info size={22} />
        </span>
        <div className="about-identity-text">
          <h2 className="about-name">{props.productName}</h2>
          <p className="about-tagline">{text.tagline}</p>
        </div>
      </header>

      <div className="about-section">
        <h3 className="about-section-title">{text.updates}</h3>
        <VersionCheckRow
          settings={props.settings}
          onUpdateSettings={props.onUpdateSettings}
          client={props.client}
        />
      </div>
    </section>
  )
}
