/**
 * 配置抽屉「这一屏脏不脏」的**唯一判据**：两个来源并成一个。
 *
 * 来源一：外壳自己上报的屏（`drawerScreen.dirty`，AI 分析 / 日报那类有保存栏的屏）；
 * 来源二：来源屏的草稿（凭据框这类输入，**参与关闭确认、不进保存栏**）。
 *
 * 两个来源各自的读写责任不同，但**关闭/切屏要不要问一句**是同一个问题；并在这里，
 * 壳只问一次。任何一处自判「我这半不重要」都会让读者默默丢草稿。
 */
export function hostScreenDirty(drawerDirty: boolean, sourcesDraftDirty: boolean): boolean {
  return drawerDirty || sourcesDraftDirty
}
