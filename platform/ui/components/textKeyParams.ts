/**
 * 填 i18n 模板里的 `{name}`（`{coverage}` 这种）。
 *
 * **只有这一份实现**：`IconButton` 的读屏名与 `Popover` 的说明共用它。两端各写一遍
 * `replace(/\\{(\\w+)\\}/g, …)` 时，缺一个参数的取舍就会分叉——一处保留占位、一处悄悄抹掉，
 * 而读者看到的结果会完全不同。
 *
 * 取舍：**找不到的参数原样保留**。缺参数在界面上看得见（`{coverage}`），比安静地少一个数字好：
 * 前者一眼就知道哪里没接上，后者会被读成一个真实的读数。
 *
 * 只接受**已格式化好的字符串**（`10–2`、`289/289`）：组件不碰数字格式，也不碰时区，
 * 那些归调用方，否则同一个数在两处会被格式化成两种样子。
 */
export function fillLabelParams(
  template: string,
  params?: Readonly<Record<string, string>>
): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return whole
    return params[name] ?? whole
  })
}
