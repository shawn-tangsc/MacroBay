[English](./filter-chip.md) | [中文](./filter-chip.zh-CN.md) | [← 文档](../README.md)

# 筛选胶囊

**可多选的筛选**——按下一个条件、列表缩小——渲染 `@platform/ui/components/filter-chip` 的
`FilterChip`。边界是刻意分开的：

| 需求 | 组件 |
| --- | --- |
| 同时打开多个筛选 | `FilterChip` |
| 一组里选一个、同一块内容 | `Segmented` |
| 状态词 | `StatusPill` |
| 不可点的分类标签 | `MetaChip` |
| 带选中态的行 | 都不是——行不是胶囊 |

**基础：包 antd `Button`。** 键盘、`type="button"`、禁用、焦点由它提供；外观仍是我们的
（高 24、胶囊圆角、`aria-pressed` 驱动的选中态）。源码：`platform/ui/components/filter-chip/`。

## `FilterChip`

```tsx
import { FilterChip, FilterChipGroup } from '@platform/ui/components/filter-chip'

<FilterChipGroup ariaLabelKey="models.categories" resolveText={t}>
  <FilterChip labelKey="models.category.llm" count="12" pressed={categories.includes('llm')}
    onPressedChange={(next) => toggleCategory('llm', next)} resolveText={t} />
</FilterChipGroup>
```

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `labelKey` | `string` | 是 | 筛选名，**收键**。 |
| `count` | `string` | 否 | **已格式化**的计数（`3`、`1.2k`），显示在文字右侧；组件不二次格式化。 |
| `pressed` | `boolean` | 是 | 当前是否按下。 |
| `onPressedChange` | `(pressed: boolean) => void` | 是 | 收**下一个值**。取反只由组件做一次，调用点不要再取一次。 |
| `disabled` | `boolean` | 否 | 禁用。原因必须**写在胶囊旁边、看得见**；组件不提供 Tooltip——禁用元素接不到焦点，悬停提示对键盘用户等于不存在。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方解析器；未知键返回空串。 |

刻意没有 `icon`、`tone`、`color`、`className`、`style`：图标会引出「这个图代表什么」的第二次
解释；系列色块是数据语义，归图例自己，不归筛选。

## `FilterChipGroup`

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `ariaLabelKey` | `string` | 是 | 这一组筛选的可访问名，**收键**。没有它读屏只念「分组」。 |
| `resolveText` | `(key: string) => string` | 是 | 同一解析器。 |
| `children` | `ReactNode` | 是 | 组内的胶囊。 |

## 选中态只有一个来源

选中样式**只写** `[aria-pressed='true']`。没有 `.on` 类、没有 `data-active`：两种画法就是两份
事实，迟早会出现「看着选中、读屏说没选」。

`opacity` 只给 `disabled`。「未选中」不许画成灰的——灰等于不可用，看到灰的人会直接放弃点击。

## 调用点要守的

- **高度 24、圆角 999**，不要按页面改。
- **计数在右侧**，由调用方格式化；需要单复数/千分位就在传入前算好。
- **禁用必须配一句看得见的说明**——「至少要留一条系列可见」——不许用 Tooltip。
- **不加图标、不加系列色块**；那两样归图例。
