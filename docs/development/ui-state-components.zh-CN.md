[English](./ui-state-components.md) | [中文](./ui-state-components.zh-CN.md) | [← 文档首页](../README.zh-CN.md)

# 状态组件

任何可能出现「空 / 等待 / 出错 / 已关闭 / 无权限」的区域，都渲染 `StateView`。它是唯一的状态面；
`EmptyState`、`ErrorState`、`DisabledHint` 三个旧身份随各调用点迁移逐个退役，不留兼容层，
也不许有第二份实现。

一个组件、六个态，文案由码选出而不是手写。理由很直接：全仓曾经长出 23 种「空」的写法和
18 种「错」的写法，因为每一页都自己造句子；而一个把异常 catch 掉、显示「暂无数据」的页面，
是在对读者撒谎。

## 组件与类型

| 导出 | 用途 |
| --- | --- |
| `StateView` | 一个有确定状态的区域：空、出错、禁用、权限、加载，或就是正常内容。 |
| `StateViewState` | 闭集：`normal` / `loading` / `empty` / `error` / `disabled` / `permission`。 |
| `StateViewAction` | 至多一个动作：`{ labelKey, onSelect }`。 |
| `StateViewProps` | 按 `state` 判别的 props 联合。 |

```tsx
import { StateView } from '@platform/ui/components/state'
```

源码：`platform/ui/components/state/`（`StateView.tsx`、`stateView.css`、组件用例）。
契约：`docs-private/05-desktop/ui-state-components-contract.md` §13；
外观规格：`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html`。

### props

`StateViewProps` 是按 `state` 判别的联合，缺必填字段**编译不过**，而不是落回一句兜底文案。

| 字段 | 类型 | 必填于 | 含义 |
| --- | --- | --- | --- |
| `state` | `StateViewState` | 总是 | 这个区域现在是六态里的哪一态。 |
| `resolveText` | `(key: string) => string` | 总是 | 调用方的文案解析入口。组件内零文案、不 import i18n。 |
| `reasonCode` | 闭集，每个态一套 | `empty` / `error` / `disabled` / `permission` | 原因**码**，不是句子。键是 `ui.state.<state>.reason.<code>`。别的态的码用在这里编译不过。 |
| `action` | `{ labelKey, onSelect }` | `empty`（除 `not-yet`）、`error`、`disabled` / `target-disabled`、`permission` 必填；`not-yet`、`capability-not-wired` 不许有 | 至多一个动作，文案也只收键。读者没有可做的事时，传动作编译不过。 |
| `details` | `{ summaryKey, bodyKey }` | 仅 `error` | 排障详情，默认折叠。 |
| `size` | `'sm' \| 'md' \| 'lg'` | 可选，默认 `md` | `lg` 整页（220）、`md` 卡内（80）。`sm` 保留、本批不许用。 |
| `children` | `ReactNode` | 仅 `normal` | 区域自己的内容。 |
| `className` | `string` | 可选 | 只做定位，不重设内部样式。 |

没有 `icon`，没有 `title` / `description` / `reason` 字符串，也没有 `spinner?: boolean`。
图标来自组件内一张表，只由 `state` 决定。

## 六个态各长什么样

| `state` | 图标 | 播报 | 必须回答 |
| --- | --- | --- | --- |
| `normal` | 无 | 不播报 | 只渲染 `children`：不套壳、不留空行。 |
| `loading` | `LoadingState` | 由 `LoadingState` 自己播报 | 在等什么。 |
| `empty` | 圆圈 | 不播报 | 为什么空（没配置 / 被筛选掉 / 还没采集）。 |
| `error` | `!` | `role="status"` + `aria-live="polite"` | 出了什么错、读者能做什么。 |
| `disabled` | 圈加斜杠 | 不播报 | 为什么不能操作，以及一个点了就能解锁的动作；平台没接通时没有动作。 |
| `permission` | 锁 | 不播报 | 缺什么、谁给得了，以及一个打开系统设置的动作。只用于系统能回答授没授权的能力。 |

`disabled` 与 `permission` 刻意共用中性色。灰度下仍可分辨，靠的是轮廓不同（圈加斜杠 vs 锁）
和动作位不同。**不许用颜色把它们分开。**

原因码是闭集；下表的动作列由类型强制，不靠评审盯：

| `state` | `reasonCode` | 动作 | 含义 |
| --- | --- | --- | --- |
| `empty` | `never-created` | 必填：创建 | 从来没有创建过。 |
| `empty` | `filtered-out` | 必填：清除筛选 | 有数据，被当前筛选挡住。 |
| `empty` | `no-target-bound` | 必填：去绑定 | 目标还没绑。 |
| `empty` | `nothing-enabled` | 必填：去启用 | 一个都没启用。 |
| `empty` | `not-yet` | 不许有 | 等事情发生之后才会出现。 |
| `error` | `unreadable` | 必填：重试 | 没读出来，不是「没有」。 |
| `error` | `unavailable` | 必填：检查来源 | 数据源本身不可用，盲目重试没有意义。 |
| `disabled` | `capability-not-wired` | 不许有 | 平台侧没接通，读者没做错。 |
| `disabled` | `target-disabled` | 必填：去启用 | 目标被停用了。 |
| `permission` | `not-granted` | 必填：去系统设置 | 只用于系统能回答「授没授权」的能力。 |

### 尺寸

| `size` | 位置 | `minHeight` |
| --- | --- | --- |
| `lg` | 整页 | `220` |
| `md`（默认） | 卡内、抽屉正文 | `80` |
| `sm` | 列表行 / 表格体 | 本批不开放 |

两个数值只有组件里一张表，写进 `style.minHeight`。调用点不许传像素值，页面 CSS 也不许再写一份
`min-height`。

## 文案

- 标题键：`ui.state.<state>`。
- 原因键：`ui.state.<state>.reason.<code>`。
- 两个键都经你传入的 `resolveText` 解析；组件不 import 任何文案表。
- 新增原因码属于契约变更：先经架构师批准，更正反两语言同笔补句，再使用。产品页不许自己造码，
  也不许自己造句子。

```tsx
// 对：状态 + 码，句子由壳层解析。
<StateView
  state="empty"
  reasonCode="never-created"
  resolveText={t}
  action={{ labelKey: 'ui.state.action.create', onSelect: create }}
/>

// 对：整页错误，详情折叠，带重试。
<StateView
  state="error"
  reasonCode="unreadable"
  resolveText={t}
  details={{ summaryKey: 'ui.state.error.details', bodyKey: 'ui.error.details.body' }}
  action={{ labelKey: 'ui.state.action.retry', onSelect: retry }}
/>

// 对：什么都还没发生，本来就没有动作可给。
<StateView state="empty" reasonCode="not-yet" resolveText={t} />

// 错：手写文案、布尔开关、像素尺寸、图标入口。
<StateView state="empty" title="暂无数据" spinner size={120} icon={<Empty />} />
```

## 用了它之后怎么验

1. **高度**：在 DevTools 里看 `.state-view` 的 `min-height`，`lg` 必须是 `220px`、`md` 必须是
   `80px`。读计算值，不看截图目测。
2. **播报**：只有 `error` 可以带 `aria-live`，且它必须是这一屏唯一的 live region。`loading` 已经
   由 `LoadingState` 自带一处，页面不许再包一层。
3. **不留空位**：`capability-not-wired` 不传 `action` 时不渲染按钮，也不留空行；`permission` 必带一个「去系统设置」，且那个 handler 必须真的能打开系统设置——必填动作配空实现，只是把死按钮换了个位置。
4. **灰度**：把 `disabled` 与 `permission` 截图去色，仍要能分开。
5. **组件零文案**：在组件里 grep 句子，必须为零。
