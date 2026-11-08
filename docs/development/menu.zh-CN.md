[English](./menu.md) | [中文](./menu.zh-CN.md) | [← 文档首页](../README.zh-CN.md)

# 菜单

右键菜单与上下文菜单一律用 `@platform/ui/components/menu` 的 `ContextMenu`。菜单项既不是按钮，
也不是可点击行——它是菜单项，而菜单项只有一份实现。

这个组件存在的理由很具体：三处界面各画了一套菜单，各写各的定位、各自的外点关闭、各自的 Esc，
而且其中只有一部分能用键盘走到。

## 组件与类型

| 导出 | 用途 |
| --- | --- |
| `ContextMenu` | 在视口某个点弹出的菜单：右键、Shift+F10、更多箭头。 |
| `MenuItem` | 一行：`{ key, labelKey, disabled?, tone? }`。 |
| `MENU_TONES` | 闭集：`['default', 'danger']`。 |
| `MenuAnchor` | 视口坐标 `{ x, y }`。 |

```tsx
import { ContextMenu, type MenuItem } from '@platform/ui/components/menu'
```

源码：`platform/ui/components/menu/`。

### props

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `open` | `boolean` | 是 | 关着时什么都不渲染，不留空壳。 |
| `anchor` | `MenuAnchor \| null` | 是 | 打开位置，视口坐标。 |
| `items` | `readonly MenuItem[]` | 是 | 按顺序的行。 |
| `onSelect` | `(key: string) => void` | 是 | 收到被选中项的 `key`，**不是索引**。 |
| `onClose` | `() => void` | 是 | Esc、外部点击、选中一项之后调用。 |
| `ariaLabelKey` | `string` | 是 | 菜单自己的可访问名（键）。上下文菜单没有触发器，借不到名字。 |
| `resolveText` | `(key: string) => string` | 是 | 调用方的文案解析入口；组件内零文案、不 import i18n。 |
| `className` | `string` | 否 | 只做定位补充，不重设内部样式。 |

`MenuItem` 是 `{ key, labelKey, disabled?, tone? }`：`key` 是回调里回来的那个值；`labelKey` 是键，
传句子编译不过；危险项只能写 `tone: 'danger'`，调用方传不了颜色。

## 哪些是包的，哪些是自己的

**列表本身是 antd 的 `Menu`，不是第二套实现。** 行的形状、选中态、`danger` 样式，以及
上/下键、Home/End、Enter 的键盘语义全部来自 antd——这正是它算「薄封装」而不是仓库里第四套菜单的原因。

我们自己的只有 antd `Menu` 单靠自己做不了的三件事：

1. **定点弹出**：`Dropdown` 把弹层挂在触发器元素上；右键没有触发器，只有一个 `(x, y)`，
   所以组件渲染到传送门里自己定位。
2. **视口夹取**：量完尺寸后把自己拉回窗口内，贴着下边缘右键不会弹出去半截。
3. **关闭**：Esc、外部点击、选中一项都关掉并通知调用方——触发器的 `aria-expanded` 与
   焦点归还因此留在调用方手里。

渲染走 `createPortal` 到 `document.body`：抽屉和列表普遍带 `overflow`，就地渲染会被裁掉。

## 怎么写

```tsx
// 对：一个点、一组行、回来的是 key。
const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

<ContextMenu
  open={menu !== null}
  anchor={menu}
  ariaLabelKey="ui.menu.row-actions"
  items={[
    { key: 'translate', labelKey: 'ui.menu.translate' },
    { key: 'delete', labelKey: 'ui.menu.delete', tone: 'danger' }
  ]}
  onSelect={(key) => {
    if (key === 'translate') void translate()
    if (key === 'delete') void remove()
  }}
  onClose={() => setMenu(null)}
  resolveText={t}
/>

// 错：手写菜单行、字面文案、传颜色、用索引回调。
<div role="menu">
  <button role="menuitem" onClick={() => pick(0)}>删除</button>
</div>
```

## 旧 → 新映射表

| 位置 | 现在 | 换成 |
| --- | --- | --- |
| `apps/desktop-shell/src/renderer/src/shell/workspace/WorkspaceTabMenu.tsx`（`WorkspaceTabStrip` 在用） | 自绘 `role="menu"` + 自己一套键盘 | `ContextMenu`，`anchor` 取 Tab 的视口矩形 |
| `apps/desktop-shell/src/renderer/src/shell/model-service/ProviderRowContextMenu.tsx` | 自绘 fixed 定位菜单，自己夹取 | `ContextMenu`，`anchor` 取 `contextmenu` 事件坐标 |
| `apps/desktop-shell/src/renderer/src/shell/model-service/ModelServiceProviderMoreMenu.tsx` | 自绘 `role="menu"` 列表 | `ContextMenu`，`anchor` 取触发器矩形 |
| 仍在自绘 `role="menu"` 列表的产品侧抽屉（产品模块不就地重写，已经用 antd 的也不动） | 自绘 `role="menu"` + 手写各项 | `ContextMenu`，`anchor` 取 `contextmenu` 事件坐标 |

已经用 antd `Dropdown` 的那批**不就地重写**：它们是挂在触发器上的菜单，不是定点菜单，不在本组件的替换范围里。
它们要统一行模型时，消费 `MenuItem`，别再长出第五种形状：`AssistantSidePanel`、`WorkspacePanelToolbar`、
`SessionItem`、`AgentMessageFileArtifacts`、`OpenExternalAppButton`、`SelectionContextMenu`。

迁移归各自所在线：本组件先落地，调用点随后切换，旧组件在最后一个调用点消失的那笔里删除。

## 用了它之后怎么验

1. **键盘**：Shift+F10 或右键打开，焦点落在第一项可用的行上，上下键能走，Esc 关闭并把焦点还回去。
2. **key 不是索引**：回调收到的是 `key`；把 `items` 换个顺序，同一项做的事不能变。
3. **危险项**：破坏性行用的是 token 色，调用点里没有任何传颜色的地方。
4. **边缘**：贴着右边缘、下边缘打开，整块菜单仍在窗口内。
5. **文案**：每一行的字都来自键；在调用点 grep 句子，必须为零。
