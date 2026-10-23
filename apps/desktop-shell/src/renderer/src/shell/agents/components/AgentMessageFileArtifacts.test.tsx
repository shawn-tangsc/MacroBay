import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AgentMessageFileArtifactSummary } from '../agentMessageFileArtifacts'
import AgentMessageFileArtifacts from './AgentMessageFileArtifacts'

const text = {
  editedSummary: (count: number) => `已编辑 ${count} 个文件`,
  touchedSummary: (count: number) => `${count} 个文件已关联`,
  changedStats: (added: number, removed: number) => `+${added} -${removed}`,
  showMore: (count: number) => `再显示 ${count} 个文件`,
  showLess: '收起文件',
  documentKind: '文档',
  codeKind: '代码',
  fileKind: '文件',
  openWith: '打开方式',
  openWithAria: (fileName: string) => `打开 ${fileName}`,
  targets: {
    vscode: 'VS Code',
    cursor: 'Cursor',
    default: 'Default app',
    terminal: 'Terminal',
    iterm2: 'iTerm2',
    xcode: 'Xcode',
    'android-studio': 'Android Studio',
    'intellij-idea': 'IntelliJ IDEA',
    pycharm: 'PyCharm',
    finder: '在 Finder 中显示'
  }
}

describe('AgentMessageFileArtifacts', () => {
  it('renders a compact summary and file rows with open-with actions', () => {
    const markup = renderToStaticMarkup(
      <AgentMessageFileArtifacts summary={summary()} text={text} />
    )

    expect(markup).toContain('agent-message-file-artifacts')
    expect(markup).toContain('已编辑 2 个文件')
    expect(markup).toContain('agent-platform.md')
    expect(markup).toContain('文档 · MD')
    expect(markup).toContain('hello.py')
    expect(markup).toContain('代码 · PY')
    expect(markup).toContain('打开方式')
  })
})

function summary(): AgentMessageFileArtifactSummary {
  return {
    totalCount: 2,
    editedCount: 2,
    generatedCount: 0,
    readCount: 0,
    addedLines: 12,
    removedLines: 4,
    files: [
      {
        id: '/Users/demo/project/notes/agent-platform.md',
        absolutePath: '/Users/demo/project/notes/agent-platform.md',
        displayPath: 'notes/agent-platform.md',
        fileName: 'agent-platform.md',
        extension: 'MD',
        kind: 'document',
        operation: 'edited'
      },
      {
        id: '/Users/demo/project/hello.py',
        absolutePath: '/Users/demo/project/hello.py',
        displayPath: 'hello.py',
        fileName: 'hello.py',
        extension: 'PY',
        kind: 'code',
        operation: 'edited'
      }
    ]
  }
}
