import type { StatusPillTone } from '@platform/ui/components/status-pill'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

/**
 * 「版本」这一行的纯视图模型：**输入已有的状态，输出这一行该怎么显示**。
 *
 * 放在组件外面，是因为这里全是判断：状态该画成哪一个药丸、哪些控件该出现、点了几次要不要变成
 * 「刚查过」。判断写在 JSX 里就只能靠渲染测，写在这里则可以直接喂状态断言——尤其
 * 「开发态不能长得像还没检查」「打开失败不许改写版本结论」这两条。
 */

export type VersionCheckPill = 'upToDate' | 'available' | 'unavailable' | 'checking' | 'notChecked' | 'autoOff'

/** 结论那一句提示；同一时刻最多一句。 */
export type VersionCheckNotice = 'available' | 'unavailable' | 'autoOff'

export type VersionCheckView = {
  /** 开发态：整行只剩一句「开发版本，不检查更新」，没有版本号、药丸、按钮、开关。 */
  development: boolean
  pill: VersionCheckPill | null
  pillTone: StatusPillTone
  /** `null` 表示不显示版本号（开发态）；`'unknown'` 表示显示「未知」。 */
  currentVersion: string | null
  /** `null` 表示显示「未知」（还没查过、查不到、或开发态）。 */
  latestVersion: string | null
  showCheckButton: boolean
  showAutoToggle: boolean
  showDownloadButton: boolean
  /** 按钮上的字：平时「检查更新」，冷却中「刚查过」——**永远同一个动作，不换第二个词**。 */
  checkLabel: 'check' | 'justChecked'
  notice: VersionCheckNotice | null
  /** 「没能打开浏览器」那句话单独一行、**加在结论下面**，不替换它。 */
  showOpenFailed: boolean
  /** 有结论但自动检查关着：把「未开启自动检查」放到**描述位**，不让它冒充状态。 */
  showAutoOffHint: boolean
}

export type VersionCheckInput = Readonly<{
  /** `null` = 还没读到主进程的投影（首帧）。 */
  state: UpdateCheckProjection | null
  autoCheckEnabled: boolean
  checking: boolean
  /** 手动冷却中（1 分钟内刚点过）。 */
  justChecked: boolean
  /** 上一次「打开下载页」没成功；**只多出下面那一句话，不动版本结论**。 */
  openFailed: boolean
}>

/**
 * 药丸文案：键取不到时回落一句通用文案。
 *
 * **不许回落成键名**（原来写的是 `?? key`）：一旦漏了一个键，用户会在设置页看到
 * `preferences.version.pill.xxx`。缺键是文案缺陷，不该以「泄漏键名」的样子出现。
 */
export function resolvePillLabel(pills: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return pills[key.slice(key.lastIndexOf('.') + 1)] ?? fallback
}

const toneByPill: Record<VersionCheckPill, StatusPillTone> = {
  upToDate: 'ok',
  available: 'info',
  unavailable: 'warn',
  checking: 'info',
  notChecked: 'muted',
  autoOff: 'muted'
}

export function describeVersionCheck(input: VersionCheckInput): VersionCheckView {
  const { state, autoCheckEnabled, checking, justChecked, openFailed } = input

  if (state?.state === 'development') {
    // 「不查」和「还没检查」必须一眼分得开：这里什么都没有，正是分开的方式。
    return {
      development: true,
      pill: null,
      pillTone: 'muted',
      currentVersion: null,
      latestVersion: null,
      showCheckButton: false,
      showAutoToggle: false,
      showDownloadButton: false,
      checkLabel: 'check',
      notice: null,
      showOpenFailed: false,
      showAutoOffHint: false
    }
  }

  const checkLabel: VersionCheckView['checkLabel'] = justChecked ? 'justChecked' : 'check'
  // 关掉自动检查只是不自动查：按钮照常可用，也不改写已经查到的结论的展示位置。
  const base = {
    development: false,
    showCheckButton: true,
    showAutoToggle: true,
    checkLabel
  } as const

  if (checking) {
    return {
      ...base,
      pill: 'checking',
      pillTone: toneByPill.checking,
      currentVersion: state?.currentVersion ?? null,
      latestVersion: state?.state === 'available' ? state.latestVersion : null,
      showDownloadButton: false,
      notice: null,
      showOpenFailed: openFailed,
      showAutoOffHint: false
    }
  }

  // 开关关掉**不是一种结论**，它只是开关的位置（原型 11-03 那张表：「开关已关 · 但已知有新版」）。
  // 所以只有「还没有任何结论」时，才退化成「未开启自动检查」那一态；已知有新版本时，
  // 药丸、版本号、下载入口一个都不许少——拿走入口等于让用户关个开关就再也装不上。
  if (!autoCheckEnabled && (state === null || state.state === 'idle')) {
    return {
      ...base,
      pill: 'autoOff',
      pillTone: toneByPill.autoOff,
      currentVersion: state === null ? null : state.currentVersion,
      latestVersion: null,
      showDownloadButton: false,
      notice: 'autoOff',
      showOpenFailed: false,
      showAutoOffHint: false
    }
  }

  switch (state?.state) {
    case 'available':
      return {
        ...base,
        pill: 'available',
        pillTone: toneByPill.available,
        currentVersion: state.currentVersion,
        latestVersion: state.latestVersion,
        showDownloadButton: true,
        // 打开失败时版本结论不动（仍是「有新版本」），只在下面补一句。
        notice: 'available',
        showOpenFailed: openFailed,
        showAutoOffHint: !autoCheckEnabled
      }
    case 'up-to-date':
      return {
        ...base,
        pill: 'upToDate',
        pillTone: toneByPill.upToDate,
        currentVersion: state.currentVersion,
        latestVersion: state.latestVersion,
        showDownloadButton: false,
        notice: null,
        showOpenFailed: openFailed,
        showAutoOffHint: !autoCheckEnabled
      }
    case 'unavailable':
      return {
        ...base,
        pill: 'unavailable',
        pillTone: toneByPill.unavailable,
        currentVersion: state.currentVersion,
        latestVersion: null,
        showDownloadButton: false,
        notice: 'unavailable',
        showOpenFailed: openFailed,
        showAutoOffHint: !autoCheckEnabled
      }
    default:
      return {
        ...base,
        pill: 'notChecked',
        pillTone: toneByPill.notChecked,
        currentVersion: state === null ? null : state.currentVersion,
        latestVersion: null,
        showDownloadButton: false,
        notice: null,
        showOpenFailed: openFailed,
        showAutoOffHint: false
      }
  }
}
