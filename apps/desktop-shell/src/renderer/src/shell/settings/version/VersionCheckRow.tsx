import { Info } from 'lucide-react'
import { Button, Switch } from 'antd'

import type { AppLanguage, AppSettings, AppSettingsPatch, TimeZoneSetting } from '@platform/settings/schema/appSettings'
import { StatusPill } from '@platform/ui/components/status-pill'
import { formatShellInstant, resolveShellTimeZone } from '@platform/ui/time/shellTimeFormat'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { platformText } from '../../../i18n/platformText'

/**
 * 「未知」不许有自己的字号/字重：它和真值共用 `.version-value`，只多一个**只改颜色**的类。
 * 这一条写在组件外面，是为了能被用例直接断言（拿到的是同一个类，只是多一个后缀）。
 */
function valueClass(version: string | null): string {
  return version === null ? 'version-value version-value-unknown' : 'version-value'
}

/** 频率说明那一行的 id：开关与「检查更新」用它挂 `aria-describedby`（组件单实例，不需要随机 id）。 */
const FREQUENCY_HINT_ID = 'version-check-frequency-hint'

/** 药丸文案键：一一对应，字面量写死在常量里（守卫用例要求键是字面量）。 */
const pillLabelKeys: Record<VersionCheckPill, string> = {
  upToDate: 'preferences.version.pill.upToDate',
  available: 'preferences.version.pill.available',
  unavailable: 'preferences.version.pill.unavailable',
  checking: 'preferences.version.pill.checking',
  notChecked: 'preferences.version.pill.notChecked',
  autoOff: 'preferences.version.pill.autoOff'
}
import { describeVersionCheck, resolvePillLabel, type VersionCheckPill } from './versionCheckViewModel'
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
  // 「打开下载页」与失败句属于关于页的链接文案（五颗按钮共用一句），不再留在更新块自己的键里。
  const linkText = platformText[language].about.links
  const actionText = platformText[language].about.action
  const row = useUpdateCheckRow(props.client ?? platformUpdateCheckClient)
  const view = describeVersionCheck({
    state: row.state,
    autoCheckEnabled: props.settings.updates.checkEnabled,
    checking: row.checking,
    justChecked: row.justChecked,
    openFailed: row.openFailed
  })

  // 键必须是字面量常量：StatusPill 的守卫要求「只收键」，动态拼出来的键既没法 grep 也没法翻。
  // 缺键时回落一句通用文案，**不回落键名**（那会让用户看见 `preferences.version.pill.xxx`）。
  const resolvePillText = (key: string): string => resolvePillLabel(text.pill as Record<string, string>, key, text.unknown)

  /**
   * 「上次检查」配的是**这一次尝试的时刻**（`checkedAt`）：这一行说的是「暂时查不到」，
   * 读者问的是「它到底试过没有」。显示上一次成功的时间会让人以为刚才那次成功了。
   */
  const checkedAtText = row.state?.state === 'unavailable'
    ? text.lastCheckedAt(
        formatShellInstant(row.state.checkedAt, { timeZone: resolveShellTimeZone(timeZone), locale: language })
      )
    : null

  const notice = (() => {
    switch (view.notice) {
      case 'available':
        return text.availableLine(view.latestVersion ?? text.unknown)
      case 'unavailable':
        return text.unavailableLine
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

      <div className="version-line">
        <span className="version-key">{text.current}</span>
        <b className={valueClass(view.currentVersion)}>{view.currentVersion ?? text.unknown}</b>
        <span className="version-sep" aria-hidden="true">
          ·
        </span>
        <span className="version-key">{text.latest}</span>
        <b className={valueClass(view.latestVersion)}>{view.latestVersion ?? text.unknown}</b>
        {view.pill === null ? null : (
          <StatusPill tone={view.pillTone} labelKey={pillLabelKeys[view.pill]} resolveText={resolvePillText} />
        )}
        <span className="version-spacer" />
        {/*
          一颗按钮、按状态换字：有新版本时它是「立即更新」（去打开发布页），其余时候是「检查更新」。
          永远只有一个动作在喊——两颗按钮并排就是两个动作抢注意力。
        */}
        <Button
          className={view.action === 'update' ? 'ant-primary-button' : 'ant-secondary-button'}
          size="small"
          loading={row.checking}
          disabled={row.checking}
          aria-describedby={view.showAutoToggle ? FREQUENCY_HINT_ID : undefined}
          onClick={() => void (view.action === 'update' ? row.openUpdateLink('download') : row.checkNow())}>
          {view.checkLabel === 'justChecked'
            ? text.justChecked
            : view.action === 'update'
              ? actionText.update
              : text.check}
        </Button>
      </div>

      {notice === null ? null : view.notice === 'unavailable' && checkedAtText !== null ? (
        // 「暂时查不到」只有两层：药丸 + 这一行。时间在前（回答「到底试过没有」），解释并在这句后面。
        // 分开两行会做出七态里最高的一档（实测 414，比带按钮的「有新版本」还高）。
        <p className="preference-hint version-notice version-checked-line">
          <span className="version-time">{checkedAtText}</span>
          {` · ${text.unavailableLine}`}
        </p>
      ) : (
        <p className="preference-hint version-notice">{notice}</p>
      )}

      {view.showAutoOffHint ? <p className="preference-hint version-auto-off-hint">{text.autoOffLine}</p> : null}

      {view.showOpenFailed ? (
        // 读屏能念；不是弹窗、不着色、不新增按钮——原按钮再点就是重试。
        <p className="preference-hint version-open-failed" role="status">
          {linkText.openFailed}
        </p>
      ) : null}

      {view.showAutoToggle ? (
        <div className="version-auto-group">
          <label className="version-auto-toggle">
            <Switch
              size="small"
              checked={props.settings.updates.checkEnabled}
              aria-describedby={FREQUENCY_HINT_ID}
              onChange={(next) => void props.onUpdateSettings({ updates: { checkEnabled: next } })}
            />
            <span>{text.autoCheck}</span>
          </label>
          {/* 读屏用户靠这个 id 听到频率说明：开关与「检查更新」都指着它，「打开下载页」不指。 */}
          <p className="preference-hint" id={FREQUENCY_HINT_ID}>
            {text.autoHint}
          </p>
        </div>
      ) : null}
    </div>
  )
}
