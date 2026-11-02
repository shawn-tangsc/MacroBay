[English](./tabs.md) | [中文](./tabs.zh-CN.md) | [← 文档](../README.md)

# 页内标签

**切换后换了一整块内容**时用 `@platform/ui/components/tabs` 的 `Tabs`；同一块内容只换一个取值时用
`Segmented`。两者不是一件组件加 `mode` 开关：交互、ARIA、键盘都不同，布尔只会把差别藏起来。

## 组件

| 导出 | 用途 |
| --- | --- |
| `Tabs` | 一个 tablist 加它的面板。 |
| `TabsProps` | props 类型。 |
| `ChoiceItem` | `{ value, labelKey, disabled? }`——与 `Segmented` 共用。 |

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
  panel={tab === 'sources' ? <Sources /> : <Storage />}
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
| `panel` | `ReactNode` | 否 | 选中项的面板；加载、空、出错都在它里面。 |

## 组件自己保证的几条

- **id 归组件**：`aria-controls` 与 `aria-labelledby` 由 `useId` 生成并互指，调用方不传 id，
  两头也不可能各写一套。
- **恰好一处 `aria-selected="true"`。**
- **键盘**：方向键即时切换（这道交互本来就是「切过去给我看」），Home/End 到首尾。
- **禁用项**不进 Tab 序列、也不参与方向键；且不挂提示——禁用的控件接不到焦点。
- **标签条永远不显示转圈**：加载、空、出错都属于面板。

## 怎么验用了它的页面

1. **键盘**：←→ 切换并带着焦点走；Home/End 到首尾。
2. **读屏**：当前项只念一次，面板与它双向互指。
3. **禁用**：Tab 与方向键都跳过，且没有提示。
4. **溢出**：标签条横向滚动，不折叠成「更多」。
