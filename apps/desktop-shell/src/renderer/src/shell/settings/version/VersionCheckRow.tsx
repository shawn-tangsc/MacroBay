import { Info } from 'lucide-react'
import { Button, Switch } from 'antd'

import type { AppLanguage, AppSettings, AppSettingsPatch, TimeZoneSetting } from '@platform/settings/schema/appSettings'
import { StatusPill } from '@platform/ui/components/status-pill'
import { formatShellInstant, resolveShellTimeZone } from '@platform/ui/time/shellTimeFormat'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { platformText } from '../../../i18n/platformText'
import { describeVersionCheck } from './versionCheckViewModel'
import { platformUpdateCheckClient, type UpdateCheckClient } from './updateCheckClient'
import { useUpdateCheckRow } from './useUpdateCheckRow'

/**
 * 设置 → 基础设置末尾的「版本」一段。
 *
 * 两条最要紧的规矩，都写在结构里而不是靠评审：
 * - **界面不持有下载地址**：这里没有任何 `<a>`、没有 `href`、不拼 URL；「打开下载页」只是一个按钮，
 *   发一个没有地址的动作给主进程，地址与白名单都在主进程里。
 * - **打开失败不改写版本结论**：失败只说一句「没能打开浏览器」，药丸和版本号一个字不动。
 *
 * 所有判断都在 `describeVersionCheck` 里，组件只把视图模型铺成 DOM——这样「开发态不许长得像
 * 还没检查」「查不到不许说成已是最新」这些能靠状态断言守住，不必靠截图。
 */
export function VersionCheckRow(props: {
  settings: AppSettings
  onUpdateSettings: (patch: AppSettingsPatch) => Promise<void>
  /** 测试注入；生产用平台客户端（唯一读 `window.platform.updates` 的地方）。 */
  client?: UpdateCheckClient
}): React.ReactElement {
  const language: AppLanguage = props.settings.language
  const timeZone: TimeZoneSetting = props.settings.timeZone
  const text = platformText[language].preferences.version
  const row = useUpdateCheckRow(props.client ?? platformUpdateCheckClient)
  const view = describeVersionCheck({
    state: row.state,
    autoCheckEnabled: props.settings.updates.checkEnabled,
    checking: row.checking,
    justChecked: row.justChecked,
    openFailed: row.openFailed
  })

  const resolvePillText = (key: string): string => {
    const name = key.replace(/^pill\./u, '')
    return (text.pill as Record<string, string>)[name] ?? key
  }

  const lastCheckedText = (projection: UpdateCheckProjection | null): string | null => {
    if (projection?.state !== 'unavailable' || projection.lastSuccessAt === null) return null
    // 时刻按读者时区格式化，界面不自己拼日期；解析不出来时格式化器原样返回。
    return text.lastCheckedAt(
      formatShellInstant(projection.lastSuccessAt, { timeZone: resolveShellTimeZone(timeZone), locale: language })
    )
  }

  const notice = (() => {
    switch (view.notice) {
      case 'available':
        return text.availableLine(view.latestVersion ?? text.unknown)
      case 'unavailable': {
        const lastChecked = lastCheckedText(row.state)
        return lastChecked === null ? text.unavailableLine : `${text.unavailableLine} ${lastChecked}`
      }
      case 'autoOff':
        return text.autoOffLine
      default:
        return null
    }
  })()

  return (
    <div className="preference-section version-section">
      <div className="preference-heading">
        <Info size={18} />
        <span>{text.title}</span>
      </div>

      {view.development ? (
        <p className="preference-hint" data-version-state="development">
          {text.devBuild}
        </p>
      ) : (
        <>
          <div className="version-line">
            <span className="version-key">{text.current}</span>
            <b className="version-value">{view.currentVersion ?? text.unknown}</b>
            <span className="version-sep" aria-hidden="true">
              ·
            </span>
            <span className="version-key">{text.latest}</span>
            <b className="version-value">{view.latestVersion ?? text.unknown}</b>
            {view.pill === null ? null : (
              <StatusPill tone={view.pillTone} labelKey={`pill.${view.pill}`} resolveText={resolvePillText} />
            )}
            <span className="version-spacer" />
            {view.showDownloadButton ? (
              <Button className="ant-secondary-button" size="small" onClick={() => void row.openDownloadPage()}>
                {text.openDownloadPage}
              </Button>
            ) : null}
            {view.showCheckButton ? (
              <Button
                className="ant-secondary-button"
                size="small"
                loading={row.checking}
                disabled={row.checking}
                onClick={() => void row.checkNow()}>
                {view.checkLabel === 'justChecked' ? text.justChecked : text.check}
              </Button>
            ) : null}
          </div>

          {notice === null ? null : <p className="preference-hint version-notice">{notice}</p>}

          {view.showOpenFailed ? (
            // 读屏能念；不是弹窗、不着色、不新增按钮——原按钮再点就是重试。
            <p className="preference-hint version-open-failed" role="status">
              {text.openDownloadFailed}
            </p>
          ) : null}

          {view.showAutoToggle ? (
            <label className="version-auto-toggle">
              <Switch
                size="small"
                checked={props.settings.updates.checkEnabled}
                onChange={(next) => void props.onUpdateSettings({ updates: { checkEnabled: next } })}
              />
              <span>{text.autoCheck}</span>
            </label>
          ) : null}

          {view.showAutoToggle ? <p className="preference-hint">{text.autoHint}</p> : null}
        </>
      )}
    </div>
  )
}
