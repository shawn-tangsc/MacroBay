import { describe, expect, it } from 'vitest'

import { buildAgentMessageFileArtifacts } from './agentMessageFileArtifacts'

describe('agent message file artifacts', () => {
  it('extracts edited and generated local files from persisted runtime parts', () => {
    const result = buildAgentMessageFileArtifacts(
      [
        {
          type: 'claude-sdk-tool-call',
          source: 'claude-agent-sdk',
          toolCallId: 'write-1',
          toolName: 'Write',
          input: { file_path: '/Users/demo/project/hello.py', content: 'print("hi")' }
        },
        {
          type: 'claude-sdk-tool-call',
          source: 'claude-agent-sdk',
          toolCallId: 'edit-1',
          toolName: 'Edit',
          input: { file_path: '/Users/demo/project/notes/agent-platform.md', old_string: 'a', new_string: 'b' }
        },
        {
          type: 'claude-sdk-tool-result',
          source: 'claude-agent-sdk',
          toolCallId: 'resource-1',
          isError: false,
          content: [
            {
              type: 'resource',
              resource: { uri: 'file:///Users/demo/project/outputs/report.md', text: '# Report' }
            }
          ]
        }
      ],
      { workspacePath: '/Users/demo/project' }
    )

    expect(result).toEqual({
      totalCount: 3,
      editedCount: 2,
      generatedCount: 1,
      readCount: 0,
      addedLines: undefined,
      removedLines: undefined,
      files: [
        {
          id: '/Users/demo/project/hello.py',
          absolutePath: '/Users/demo/project/hello.py',
          displayPath: 'hello.py',
          fileName: 'hello.py',
          extension: 'PY',
          kind: 'code',
          operation: 'edited'
        },
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
          id: '/Users/demo/project/outputs/report.md',
          absolutePath: '/Users/demo/project/outputs/report.md',
          displayPath: 'outputs/report.md',
          fileName: 'report.md',
          extension: 'MD',
          kind: 'document',
          operation: 'generated'
        }
      ]
    })
  })

  it('de-dupes files and upgrades read files when a later edit touches the same path', () => {
    const result = buildAgentMessageFileArtifacts(
      [
        {
          type: 'claude-sdk-tool-call',
          toolCallId: 'read-1',
          toolName: 'Read',
          input: { file_path: '/Users/demo/project/src/App.tsx' }
        },
        {
          type: 'claude-sdk-tool-call',
          toolCallId: 'edit-1',
          toolName: 'MultiEdit',
          input: { file_path: '/Users/demo/project/src/App.tsx', edits: [] }
        }
      ],
      { workspacePath: '/Users/demo/project/' }
    )

    expect(result.totalCount).toBe(1)
    expect(result.editedCount).toBe(1)
    expect(result.readCount).toBe(0)
    expect(result.files[0]).toMatchObject({
      absolutePath: '/Users/demo/project/src/App.tsx',
      displayPath: 'src/App.tsx',
      fileName: 'App.tsx',
      extension: 'TSX',
      kind: 'code',
      operation: 'edited'
    })
  })
})
