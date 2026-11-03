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
  /**
   * 开发态（源码启动）。**不再是「整行只剩一句话」**：用户 11-03 要求整块照画、与安装版同形，
   * 只是点「检查更新」不联网、就地出一句提示。这个标志用来决定**点击后**说不说那句，
   * 不决定画不画版本号/药丸/按钮/开关。
   */
  development: boolean
  pill: VersionCheckPill | null
  pillTone: StatusPillTone
  /** `null` 表示不显示版本号（首帧投影还没到，或读不到投影）；`'unknown'` 表示显示「未知」。 */
  currentVersion: string | null
  /** `null` 表示显示「未知」（还没查过、查不到、或开发态没有结论）。 */
  latestVersion: string | null
  /** 更新块里唯一一颗动作按钮：`check` 查一次，`update` 去发布页拿包。**永远只有一颗**。 */
  action: 'check' | 'update'
  showAutoToggle: boolean
  /** 冷却期按钮上写「刚查过」：仍是同一个动作，不换第二个词。 */
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

/**
 * 侧栏小点亮不亮：**只看结论的 `state`**。
 *
 * 查不到（`unavailable`）永远不亮——「拿失败当有新版」在结构上就不可能；`idle`/`development`
 * 也不亮。壳层不许拿版本号再算一遍，那是第二个来源。
 */
export function shouldShowUpdateDot(projection: UpdateCheckProjection | null): boolean {
  return projection?.state === 'available'
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
    // 开发态**与安装版同形**（用户 11-03 定的）：版本号、药丸、按钮、开关都在，初值是「还没检查」。
    // 唯一差别在点击之后——那一下不联网，就地出一句提示（在组件里，不在这个视图模型里）。
    // 这不是拿开发态冒充 idle：投影里仍是 `development`，只是这块必须长得和装好的包一样，
    // 否则用户在自己的窗口里永远看不清这块究竟做成什么样。
    return {
      development: true,
      pill: 'notChecked',
      pillTone: toneByPill.notChecked,
      currentVersion: state.currentVersion,
      // 没查过就是「未知」：开发态不产生结论，这里不替远端猜一个版本号。
      latestVersion: null,
      action: 'check',
      showAutoToggle: true,
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
    action: 'check',
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
      action: 'check',
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
        action: 'update',
        // 打开失败时版本结论不动（仍是「有新版本」），只在下面补一句。
        notice: 'available',
        showOpenFailed: openFailed,
        // 描述位只放一句：这句的解释权高于「开关关着」，两句叠起来就把整段做回最高的一档。
        showAutoOffHint: false
      }
    case 'up-to-date':
      return {
        ...base,
        pill: 'upToDate',
        pillTone: toneByPill.upToDate,
        currentVersion: state.currentVersion,
        latestVersion: state.latestVersion,
        action: 'check',
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
        action: 'check',
        notice: 'unavailable',
        showOpenFailed: openFailed,
        showAutoOffHint: false
      }
    default:
      return {
        ...base,
        pill: 'notChecked',
        pillTone: toneByPill.notChecked,
        currentVersion: state === null ? null : state.currentVersion,
        latestVersion: null,
        action: 'check',
        notice: null,
        showOpenFailed: openFailed,
        showAutoOffHint: false
      }
  }
}
