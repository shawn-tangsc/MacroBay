/**
 * 哪些「要提交的文件」不在主 `typecheck` 的覆盖范围里。
 *
 * 为什么需要这一份判断：`tsconfig.json` 的 include 有一处长期没生效——
 * 产品目录那条 glob 里写了花括号，而 TypeScript 不支持花括号，于是整个 `products/`
 * 从来没被检查过（tsconfig 修正排在 tag 之后）。**今天没人发现，就是因为没有任何一步会说出
 * 「这个文件没被查」**。
 *
 * 预检钩子的主路径跑的是同一份 `tsconfig.json`，所以它也继承了这个洞：提交一个 `products/` 下的
 * 文件，全仓 typecheck 通过，等于什么都没查。更糟的是钩子超预算时会退一步用 `files: [本次文件]`
 * ——那条路反而**会**查到这些文件。于是同一个提交，机器快时漏查、机器慢时查得到：
 * **覆盖范围取决于耗时**，这比固定漏查更难发现。
 *
 * 所以把判断拆成这个纯函数：主路径之后，对这里列出的文件再单独查一次，让覆盖不再取决于机器忙闲。
 */

/** 主 `tsconfig.json` 没有真正匹配到的路径前缀。修正 include 时这一份要跟着删。 */
export const OUTSIDE_PROJECT_INCLUDE: readonly string[] = ['products/', 'tools/', 'vitest.config.ts']

/** 只判代码文件；`.md`、`.css` 之类不进类型检查，列出来只会制造噪音。 */
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/

export function filesOutsideProjectInclude(staged: readonly string[]): string[] {
  return staged.filter(
    (path) => CODE_FILE.test(path) && OUTSIDE_PROJECT_INCLUDE.some((prefix) => path.startsWith(prefix))
  )
}
