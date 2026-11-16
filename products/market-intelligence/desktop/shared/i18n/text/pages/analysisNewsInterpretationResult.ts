/**
 * 按条「AI 解读」结果条的文案（归简报线；新闻抽屉「解读节」的文案归舆情，不在这里）。
 *
 * 一格一句：每个码给「读者看到的一句」与「能做什么」，动作是闭集里的一个 token，界面据此接
 * 设置页 / 重试 / 刷新 / 查看原因，不去匹配句子。表外的码不直通——落到兜底那一句。
 */
export const analysisNewsInterpretationResultText = {
  'zh-CN': {
    states: {
      'analysis-not-enabled': { sentence: '还没开启 AI 分析', action: '打开 AI 分析' },
      'analysis-provider-not-ready': { sentence: '模型还没配置好，解读跑不了', action: '去配置模型' },
      'analysis-initial-request-unavailable': { sentence: '分析服务正在启动，稍后再试', action: '稍后再试' },
      'analysis-initial-request-failed': { sentence: '这次没能排上分析', action: '再试一次' },
      'analysis-event-group-not-found': { sentence: '这条的内部状态对不上，刷新后再试', action: '刷新' },
      'insufficient-facts:trigger-evidence-missing': { sentence: '这条新闻的引用建不出来，暂时没法解读它', action: '查看原因' },
      'insufficient-facts:market-facts-below-minimum': { sentence: '当前可用的市场读数不足两条，解读只能编，先不跑', action: '查看原因' },
      // 「没有判定」与「不够格」不是一个意思：前者只能等，后者本来就不该点。两件事不许共用兜底那一句。
      'no-judgment': { sentence: '这条还没有情绪判定，等判定写下来才能解读', action: null },
      // 运行被打断/卡住：它不是「跑完了」，也不是「没能开始」——那句话会说错话（没有与拿不到要分开）。
      'analysis-run-interrupted': { sentence: '这次解读没跑完（应用关了或运行时中断），可再试一次', action: '再试一次' },
      'not-eligible': { sentence: '这条不在可单独解读的范围内', action: null }
    },
    /** 表外的码只落到这一句：读者能做的只有再试一次。 */
    fallback: { sentence: '这次没能开始解读', action: null }
  },
  'en-US': {
    states: {
      'analysis-not-enabled': { sentence: 'AI analysis is off', action: 'Turn on AI analysis' },
      'analysis-provider-not-ready': { sentence: 'No model is configured, so the reading cannot run', action: 'Configure a model' },
      'analysis-initial-request-unavailable': { sentence: 'The analysis service is still starting; try again shortly', action: 'Try again shortly' },
      'analysis-initial-request-failed': { sentence: 'The analysis could not be queued this time', action: 'Try again' },
      'analysis-event-group-not-found': { sentence: 'This item is out of step internally; refresh and try again', action: 'Refresh' },
      'insufficient-facts:trigger-evidence-missing': { sentence: 'The evidence reference for this news could not be built, so it cannot be read yet', action: 'See why' },
      'insufficient-facts:market-facts-below-minimum': { sentence: 'Fewer than two market readings are available, so a reading would have to invent them; not running it', action: 'See why' },
      'no-judgment': { sentence: 'This item has no sentiment judgment yet; it can be read once one is written', action: null },
      'analysis-run-interrupted': { sentence: 'The interpretation was interrupted (the app closed or the runtime stopped); try again', action: 'Try again' },
      'not-eligible': { sentence: 'This item is not something that can be read on its own', action: null }
    },
    fallback: { sentence: 'The reading could not start this time', action: null }
  }
} as const
