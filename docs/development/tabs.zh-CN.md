[English](./tabs.md) | [中文](./tabs.zh-CN.md) | [← 文档](../README.md)

# 页内标签

**切换后换了一整块内容**时用 `@platform/ui/components/tabs` 的 `Tabs`；同一块内容只换一个取值时用
`Segmented`。两者不是一件组件加 `mode` 开关：交互、ARIA、键盘都不同，布尔只会把差别藏起来。

**一个定义，只在一处。** `ChoiceItem` 的形状与「选中值失效」的兜底规则（`useChoiceValue`）写在**本页**，
`segmented.md` 只指回来、不再复述。改 `ChoiceItem` 的形状或兜底规则时，**两份文档同笔改**——
一份还写着旧形状，比没有这份文档更糟。

## 组件

| 导出 | 用途 |
| --- | --- |
| `Tabs` | 一个 tablist 加它的面板。 |
| `TabsProps` | props 类型。 |
| `ChoiceItem` | `{ value, labelKey, disabled? }`——与 `Segmented` 共用，**权威定义在本页**。 |

```tsx
<Tabs
  items={[
    { value: 'sources', labelKey: 'settings.tabs.sources' },
    { value: 'storage', labelKey: 'settings.tabs.storage' }
  ]}
  value={tab}
  onChange={setTab}
  ariaLabelKey="settings.tabs.group"
  resolveText={t}
  panels={{ sources: <Sources />, storage: <Storage /> }}
/>
```

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `items` | `ChoiceItem[]` | 是 | 标签项。`value` 是稳定标识，**绝不用下标**。 |
| `value` | `string` | 是 | 当前选中项的 `value`。 |
| `onChange` | `(value: string) => void` | 是 | 回传新的 `value`。 |
| `ariaLabelKey` | `string` | 是 | tablist 的可访问名，**收键**。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的解析入口。 |
| `panels` | `Readonly<Record<string, ReactNode>>` | 是 | 每个页签一块，按 `value` 取。**全部挂载**，非活动块加原生 `hidden`。加载、空、出错都在各自面板里。没有面板就不该用 `Tabs`——那该用 `Segmented` 或不要页签。 |

## 组件自己保证的几条

- **id 归组件**：`aria-controls` 与 `aria-labelledby` 由 `useId` 生成并互指，调用方不传 id，
  两头也不可能各写一套。
- **恰好一处 `aria-selected="true"`。**
- **键盘**：方向键即时切换（这道交互本来就是「切过去给我看」），Home/End 到首尾。
- **禁用项**不进 Tab 序列、也不参与方向键；且不挂提示——禁用的控件接不到焦点。
- **标签条永远不显示转圈**：加载、空、出错都属于面板。
- **选中值失效时整组仍进得来**：`value` 不在 `items` 里（项被增删）时，首个可用项接管键盘入口，
  组件在 effect 里**回调一次** `onChange(首个可用值)`，门闩按过期值记。只兜显示不回调，就会
  「看着是 A、动起来是 B」，之后保存或导出用的是 B。
- **每块面板都保持挂载，非活动的加 `hidden`**：切走再切回，另一半的会话、时间轴选中项、拖拽宽度
  都还在。用**原生 `hidden`**（同时退出布局与无障碍树），不许用 `aria-hidden` 顶替，也不许靠手写
  `display:none`——两边各维护一套，迟早对不上。
- **挂载 ≠ 继续运行**：组件只负责挂载与可达性，不替调用方暂停隐藏面板里的计时器、轮询与订阅，
  也**不提供可见性回调**。调用方手里就有 `value`，自己判断即可——组件一旦「猜哪个面板该停」，
  调用方就会以为不需要自己判断。简报生成时每秒查进度那一段，放进隐藏面板后必须自己按可见性停。
- **面板保留自己的状态**：组件不从 props 派生面板内容，所以非活动面板里读者留下的东西不会丢，
  这正是「保持挂载」要买到的东西。

## 怎么验用了它的页面

1. **键盘**：←→ 切换并带着焦点走；Home/End 到首尾。
2. **读屏**：当前项只念一次，面板与它双向互指。
3. **禁用**：Tab 与方向键都跳过，且没有提示。
4. **溢出**：标签条横向滚动，不折叠成「更多」。
