import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import AgentAskUserQuestionCard from './AgentAskUserQuestionCard'

const input = JSON.stringify({
  questions: [
    {
      question: '你希望怎么呈现翻译模型？',
      header: '翻译模型',
      multiSelect: false,
      options: [
        { label: '只跟随默认 (Recommended)', description: '只读模型服务的默认翻译模型。' },
        { label: '默认跟随 + 可覆盖', description: '保留选择器，默认跟随模型服务。' }
      ]
    }
  ]
})

describe('AgentAskUserQuestionCard', () => {
  it('renders the question, numbered options, recommendation and answer controls', () => {
    const markup = renderToStaticMarkup(
      <AgentAskUserQuestionCard
        inputText={input}
        labels={{ title: '确认交互', freeform: '输入你的答案', skip: '跳过', submit: '提交', recommended: '推荐' }}
        onResolve={() => undefined}
      />
    )

    expect(markup).toContain('确认交互')
    expect(markup).toContain('你希望怎么呈现翻译模型？')
    expect(markup).toContain('只跟随默认')
    expect(markup).toContain('推荐')
    expect(markup).toContain('输入你的答案')
    expect(markup).toContain('跳过')
    expect(markup).toContain('提交')
  })
})
