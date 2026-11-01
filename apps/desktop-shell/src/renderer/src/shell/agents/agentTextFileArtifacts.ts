/**
 * 运行活动里「文件产物」那张小卡的文案形状。
 *
 * 从 `agentTextTypes.ts` 拆出来：那份文件是运行活动全部句子的形状表，已顶到 360 行的架构闸门，
 * 而文件产物（编辑/关联/打开方式的说法）与「问答、执行组」不是同一件事，单独一处更好改。
 * 实现仍在 `agentTextZhRuntime.ts` / `agentTextEnRuntime.ts` 的同一份对象里，这里只搬类型。
 */
export type AgentTextFileArtifacts = {
  editedSummary: (count: number) => string
  touchedSummary: (count: number) => string
  changedStats: (added: number, removed: number) => string
  showMore: (count: number) => string
  showLess: string
  documentKind: string
  codeKind: string
  fileKind: string
  openWith: string
  openWithAria: (fileName: string) => string
  targets: {
    vscode: string
    cursor: string
    default: string
    terminal: string
    iterm2: string
    xcode: string
    'android-studio': string
    'intellij-idea': string
    pycharm: string
    finder: string
  }
}
