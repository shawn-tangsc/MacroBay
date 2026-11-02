[English](./segmented.md) | [中文](./segmented.zh-CN.md) | [← 文档](../README.md)

# 分段选择

**同一块内容只换一个取值**（范围、视图、语言）时用 `@platform/ui/components/segmented` 的
`Segmented`；切换后换一整块内容时用 `Tabs`。

## 组件

| 导出 | 用途 |
| --- | --- |
| `Segmented` | 一组互斥取值。 |
| `SegmentedProps` | props 类型。 |
| `ChoiceItem` | `{ value, labelKey, disabled? }`——与 `Tabs` 共用。 |

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `items` | `ChoiceItem[]` | 是 | 取值项。`value` 是稳定标识，绝不用下标。 |
| `value` | `string` | 是 | 当前取值。 |
| `onChange` | `(value: string) => void` | 是 | 回传新取值。 |
| `ariaLabelKey` | `string` | 是 | 这一组取值的可访问名，收键。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的解析入口。 |

## 组件自己保证的几条

- **它是一组被按下的取值，不是 tablist**：容器是 `role="group"`，选中项是 `aria-pressed="true"`，
  且恰好一处为真。
- **方向键只移焦，Enter / Space 才选中**。这里移焦不能改值——读者往往要先看两三个再定。
- **禁用项**不进 Tab 序列、也不参与方向键。
- **灰度可辨**：选中项靠底色与字重区分，不靠色相。

## 怎么验用了它的页面

1. **键盘**：←→ 只移焦不改值；Enter 或 Space 才选中。
2. **读屏**：组有名字，且恰好一个取值是按下态。
3. **禁用**：Tab 与方向键都跳过。
4. **灰度**：选中项仍然一眼看得出。
