import type { ProductSkillRegistration } from '../../../platform/product-manifest'

/**
 * 本产品的技能声明（清单里的 `skills`）。
 *
 * 单独成文件是因为清单已到体积线：这里是**纯数据**，不读环境、不判断。改技能只动这一处，
 * 清单那边只留一行引用。
 */
export const marketIntelligenceSkills: readonly ProductSkillRegistration[] = [
  { id: 'market-analysis-skill-v1', title: '市场影响分析', description: '使用可追溯证据生成条件式市场分析。', module: './agents/skills/market-analysis' },
  {
    id: 'daily-brief-editor-skill-v1',
    title: '每日简报 AI 编辑',
    description: '以交易分析师视角决定日报候选的展示与 why，缺失结论可带来源补查。',
    module: './agents/skills/daily-brief-editor'
  },
  {
    id: 'intelligence-ops-skill-v1',
    title: '情报运维',
    description: '先读后写、一次一改、凭据不经过模型。',
    module: './agents/skills/intelligence-ops'
  }
]
