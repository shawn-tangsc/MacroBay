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

- 动作标签是**从动作键闭集里挑**，不是调用点自己写：码定**原因**，类型定动作**允不允许**，调用点选**挑哪一个**。
  闭集里没有能表达这一步的标签时，同一笔加键（键表 + 中英各一句）；**不许把 `labelKey` 放宽成 `string`**，
  否则一个拼错的键就会原样显示给读者。

```tsx
import { StateView } from '@platform/ui/components/state'
```

源码：`platform/ui/components/state/`（`StateView.tsx`、`stateView.css`、`stateViewText.ts`、组件用例）。状态与原因码联合只定义一次，在 `platform/contracts/queryOutcome.ts`；`StateView` 只转出，查询层返回的形态是 `QueryOutcome<T>`。
契约：`docs-private/05-desktop/ui-state-components-contract.md` §13；
外观规格：`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html`。

### props

`StateViewProps` 是按 `state` 判别的联合，用错态的码**编译不过**，而不是落回一句兜底文案。

| 字段 | 类型 | 必填于 | 含义 |
| --- | --- | --- | --- |
| `state` | `StateViewState` | 总是 | 这个区域现在是六态里的哪一态。 |
| `resolveText` | `(key: StateViewTextKey) => string` | 可选 | 仅供测试注入。生产走 `useStateViewText()`（语言取自壳层上下文），句子唯一一份在 `platform/ui/components/state/stateViewText.ts`。 |
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

原因码是闭集；下表的动作列是**审核判据，不是类型约束**：`action` 在所有码上都是可选的，给不给由场景决定。`required` 标的是「不给动作就是缺陷」的码，`optional` 标的是两种都对、看具体站点的码。

| `state` | `reasonCode` | 动作 | 含义 |
| --- | --- | --- | --- |
| `empty` | `never-created` | 必填：创建 —— `create` | 从来没有创建过。 |
| `empty` | `filtered-out` | 必填：清除筛选 —— `clear-filter` | 有数据，被当前筛选挡住。 |
| `empty` | `no-target-bound` | 必填：去绑定 —— `bind-target` | 目标还没绑。 |
| `empty` | `nothing-enabled` | 必填：去启用 —— `enable` | 一个都没启用。 |
| `empty` | `none-installed` | 必填：按站点选一种恢复方式——`install`（有列表可挑）/ `focus-form`（同屏有表单）/ `bind-target`（已有目标可绑）/ `open-settings`（本屏给不了入口） | 这里从来没有装过或绑定过；读者自己能解决。 |
| `empty` | `no-target-selected` | 必填：聚焦选择区 —— `select-target` / `focus-form` | 目标可以挑，但还没选。 |
| `empty` | `not-yet` | 不许有 | 等事情发生之后才会出现；在这里给按钮就是假动作。 |
| `empty` | `never-ran` | 必填：现在跑一次 —— `run-now` | 一次都还没跑过，读者能自己启动。与 `not-yet`（事实、无事可做）分开，是一个码装两种处境时拆出来的。 |
| `empty` | `target-missing` | 必填：回到列表 —— `back-to-list` | 目标本身已被删除：这是「拿不到」，不是「没有」。不许复用 `target-disabled`（那要求去启用）。 |
| `empty` | `older-than-window` | 必填：查看全部 —— `widen-time-window` | 有数据，但都在这段窗口之外——这是「查过了，有」，不是「还没到」。 |
| `empty` | `nothing-in-window` | 可选 —— 有出口时用 `widen-time-window` 或 `open-settings` | 这段窗口里确实什么都没有——这是「查过了，没有」，不许用 `not-yet` 顶替。整月没有事件可以给「打开设置」，确实没有消息就不给动作。 |
| `error` | `unreadable` | 必填：重试 —— `retry` | 没读出来，不是「没有」。 |
| `error` | `unavailable` | 必填：检查来源 —— `check-source` / `retry` / `refresh` | 数据源本身不可用，盲目重试没有意义。 |
| `error` | `operation-failed` | 必填：重试 —— `retry` | 写操作（创建、保存、更新、删除）没成功——不是读失败。 |
| `error` | `needs-restart` | 必填：重启应用 —— `restart-app` | 本地接口缺失，只有重启才加载。 |
| `error` | `page-load-failed` | 必填：重新载入界面 —— `reload-page` | 页面本身没有加载成功。恢复办法是重载页面——不是 `retry`（那次操作重试），也不是 `restart-app`（代价完全不同）。 |
| `disabled` | `capability-not-wired` | 不许有 | 平台侧没接通，读者没做错。 |
| `disabled` | `target-disabled` | 必填：去启用 —— `enable` | 目标被停用了。 |
| `disabled` | `precondition-unsaved` | 必填：保存 —— `save` | 表单还没保存，保存之后才能继续。 |
| `permission` | `not-granted` | 必填：去系统设置 —— `open-system-settings` | 只用于系统能回答「授没授权」的能力。 |

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
- 默认经 `useStateViewText()` 解析（语言取自 `ShellLanguageProvider`），`resolveText` 只是测试用的覆盖入口；句子表与动作键常量都只有一份，在 `platform/ui`。
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

### 产品自己的原因句（带参数）

平台码表不扩产品码。产品确实需要自己那句话时，只覆盖**原因句这一格**——标题、图标、播报、动作仍归平台：

```tsx
<StateView
  state="disabled"
  reasonCode="target-disabled"
  productReason={{
    key: 'mi.newsSentiment.staleSince',            // 必须带产品前缀，不许用 ui.*
    params: { moment: formatInstant(updatedAt) },  // 已经格式化好的展示值，只收字符串
    resolve: (key, params) => productT(key, params) // 第二个参数必须接住
  }}
  action={{ labelKey: 'ui.state.action.refresh', onSelect: refresh }}
/>
```

- `params` 只收**已经格式化好**的字符串：时刻先经平台时间格式化器算好再传，所以产品没法从这里塞数字或 `Date`，也没法自己 `toLocaleString()`；
- 缺键、空串、抛错**一律回落平台句**，原因格带 `data-reason-source="product" | "platform"`，调用点测试据此断言走的是哪一路；
- `resolve` 必须收两个参数：写成 `(key) => …` 会把参数吃掉，界面上直接露出 `{时刻}`——守卫 `textResolverGuard` 当场红；
- 只存在于四种有原因句的态（`empty` / `error` / `disabled` / `permission`）；`normal` / `loading` 传了编译不过。

## 状态判定可以决定什么

一次状态判定只产出一个 `(state, reasonCode)` 元组，别的都不产。下面三件事由数据决定，不由状态决定：

| 由数据决定 | 不许由状态决定 |
| --- | --- |
| 内容渲不渲染——`rows.length > 0` | 拿 `state === 'empty'` 当分支去藏一张表 |
| 控件出不出——「加载更多」看 `hasMore`、「重试」看有没有 `error`、「清除筛选」看有没有筛选词 | 用一个状态位开关分页 |
| 动作去往哪里——看数据上下文 | 一个原因码隐含一个目的地 |

判定错了，用户最多少看到一句不该说的话。一旦判定还能藏掉表格、藏掉分页、藏掉整页，同一个错误就升级成**数据不可见**，而且**不会有任何人来报这个 bug**——列表看起来只是到底了。

所以正确的写法是 `rows.length > 0 ? <内容> : <StateView …>`，**不是**把 `<StateView>` 放在三元的一个分支、另一个分支放内容。

## 产品原因句

产品自己的文案里有平台不知道的事实（例如「截至某时刻」）时，可以只替换**原因句这一格**（§17）：

```tsx
<StateView
  state="empty"
  reasonCode="older-than-window"
  productReason={{
    key: 'mi.newsSentiment.stale',
    params: { time: formatTime(asOf, 'minute') },  // 先由平台格式化器算好
    resolve: (key, params) => text[key]?.(params) ?? ''
  }}
  resolveText={t}
/>
```

- `key` 必须带产品前缀（`mi.*`），守卫会扫；
- `params` 只收字符串：时刻必须先用平台格式化器算好。数字进不来，原始时间戳到不了句子里；
- 缺键、空串、抛错**一律回落平台句**；原因节点带 `data-reason-source="product" | "platform"`，
  调用点测试能断言走的是哪一路——落回不许静默，否则缺文案永远没人发现；
- 标题、图标、播报、动作仍归平台。这里只是一格，不是第二套文案表。

## 读取的生命周期：`AsyncState<T>`

十四个模块各写一个三态联合，就是同一个 bug 回来十四次。唯一实现在
`platform/ui/async/asyncState.ts`：

```ts
export type AsyncState<T> =
  | { status: 'loading'; data?: never }
  | { status: 'ready'; data: T; refreshing?: true; stale?: true }
  | { status: 'error'; reasonCode: ErrorReasonCode; data?: never }
```

- `data` **只挂在 `ready` 上**，所以「首帧画一张错误、再翻成数据」在类型上写不出来；任何要行的分支都得先证明 `ready`。
- `reasonCode` 取 `platform/contracts/queryOutcome` 的闭集。`AsyncState` 是**读取的生命周期**，`QueryOutcome` 是**数据层的终态结果**，一个包着另一个。
- `refreshing`（正在刷新）与 `stale`（上次刷新失败）是两件事，文案分开，**两者都不许清空数据**。
- 初值只有一种写法：`initialAsyncState<T>()`，不写字面量。
- 规矩落在转移函数里：`beginRefresh` 保留数据、`failRefresh` 保留数据并标 `stale`、`settle` 清两个标记。调用点自己写 `setState({ status: 'error' })` 正是这个类型要防的 bug。

### 把一个读取迁过来

```ts
// 改前：初值就是终态——每次挂载先闪一帧「读不到」。
const [state, setState] = useState<View>('unavailable')
useEffect(() => { read().then(rows => setState(rows), () => setState('unavailable')) }, [])
// 刷新时：setState('unavailable')   ← 把读者正在看的东西删掉了

// 改后：先 loading，刷新失败保留旧数据。
const [state, setState] = useState<AsyncState<Row[]>>(initialAsyncState)
useEffect(() => {
  setState(beginRefresh)
  read().then(rows => setState(prev => settle(prev, rows)), () => setState(prev => failRefresh(prev, 'unreadable')))
}, [reloadKey])
// 渲染：loading → <StateView state="loading" />；error → <StateView state="error" reasonCode={state.reasonCode} />
// ready → <Rows rows={state.data} stale={state.stale === true} refreshing={state.refreshing === true} />
```

**怎么强制**：`scripts/check-async-initial-state.mts`（进 `pnpm verify`）在 `useState` 初值是终态、或初值不是工厂调用时红，带只减不增的白名单；
`platform/ui/async/expectWaitingFirst.tsx` 在解析前断言「等的是加载态，不是错误/空/禁用/权限」——这是唯一能抓「加载写成 unavailable」的办法，因为那种写法类型正确。

## 用了它之后怎么验

1. **高度**：在 DevTools 里看 `.state-view` 的 `min-height`，`lg` 必须是 `220px`、`md` 必须是
   `80px`。读计算值，不看截图目测。
2. **播报**：只有 `error` 可以带 `aria-live`，且它必须是这一屏唯一的 live region。`loading` 已经
   由 `LoadingState` 自带一处，页面不许再包一层。
3. **不留空位**：`capability-not-wired` 不传 `action` 时不渲染按钮，也不留空行；`permission` 必带一个「去系统设置」，且那个 handler 必须真的能打开系统设置——必填动作配空实现，只是把死按钮换了个位置。
4. **灰度**：把 `disabled` 与 `permission` 截图去色，仍要能分开。
5. **组件零文案**：在组件里 grep 句子，必须为零。
