/**
 * The reader time zone the brief schedule, its cutoff and the "today" it reads all use.
 *
 * It comes from the platform hook (the shell's single time zone reader) and there is no fallback:
 * a missing hook used to resolve to UTC, which quietly put every reader in UTC while the interface
 * said otherwise. A missing hook is now a loud failure instead of a plausible-looking value.
 */
type ReaderTimeZoneHook = Readonly<{ getTimeZone: () => string }>

/**
 * 传入的形状必须包含「可能没有钩子」：缺钩子是装配期真实会发生的输入，函数的存在就是为了让它
 * 响亮失败；签名写成必填会把这条运行时契约藏到类型后面（调用方只能靠强转才能测它）。
 */
export function resolveBriefingTimeZone(hooks: Partial<ReaderTimeZoneHook> | undefined): string {
  if (!hooks?.getTimeZone) throw new Error('reader-time-zone-hook-missing')
  return hooks.getTimeZone()
}

