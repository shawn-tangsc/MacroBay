import type { AssistantTemplateRegistration } from './assistantTemplateSchemas'

export const platformAssistantTemplates: readonly AssistantTemplateRegistration[] = [
  {
    templateId: 'default-assistant',
    sourceKind: 'platform',
    version: 1,
    name: { 'zh-CN': '默认助手', 'en-US': 'Default Assistant' },
    description: { 'zh-CN': '适合日常问答、整理信息和轻量分析。', 'en-US': 'Useful for everyday questions, organization, and lightweight analysis.' },
    icon: '💬',
    prompt: {
      'zh-CN': '你是一个清晰、可靠、友好的桌面 AI 助手。请先理解用户目标，再给出简洁可执行的帮助。',
      'en-US': 'You are a clear, reliable, and friendly desktop AI assistant. Understand the user goal first, then provide concise and actionable help.'
    },
    groups: ['featured', 'general'],
    tags: [{ 'zh-CN': '通用', 'en-US': 'General' }]
  }
]
