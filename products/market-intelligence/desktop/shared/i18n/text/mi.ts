/* 只搬位置，不改句子：本条文案归这个文件独占，改之前先看清它属于哪条线。 */
export const miText = {
  'zh-CN': {
  aiInterpretation: {
    // 可见标题自解释（产品定），菜单项仍是动作名「AI 解读」，两者不是一回事。
    title: '这条新闻对市场的影响',
    // 产品终版（2026-11-16）：只进 ⓘ 浮层，正文不放；日历事件详情复用同一组件时语义同样成立。
    info: '这条新闻影响哪些资产、影响是什么；没有影响时也会直说。',
    infoAria: '这一节说明什么',
    // 菜单项是动作名，与节标题不是一回事（节标题自解释「这条新闻对市场的影响」）。
    readFailed: '暂时读不到这条解读，可再试一次',
    generating: '正在生成',
    readResult: '读取结果',
    menuUnreadable: '暂时读不到这条解读',
    unreachable: '没送到分析服务，可再试一次',
    runFailed: '这次解读跑完了但没生成出结果，可再试一次',
    // 等过时限（3 分钟）仍没有结果：服务端可能挂住、或应用中途被关。必须落失败态，不许继续转圈。
    waitExceeded: '这次没跑完，可再试一次',
    retry: '再试一次',
    meta: '生成于 {time} · 依据：该条新闻 + 解读时的数据（{count} 条证据）',
    audit: {
      summary: '审计信息',
      asOf: '分析时点',
      dataCutoff: '数据截止',
      factCount: '事实条数',
      evidenceRefCount: '证据引用',
      domains: '覆盖域',
      runId: '分析运行',
      snapshotHash: '数据版本'
    }
  },
  newsSentiment: {
    unavailable: '舆情暂时不可用。',
    // 2026-11-18：有新闻、但没判出来。三句分别对应「原因不明 / 模型没开 / 模型不可用」——
    // 都不许退回「这段时间没有相关消息」，那是一句假话。
    unjudged: '有新条目，但都还没有判定。',
    unjudgedModelOff: '有新条目，但都还没有判定——判断新闻方向用的模型没有开启，在舆情设置里开启后就会判出来。',
    unjudgedModelUnavailable: '有新条目，但都还没有判定——判断新闻方向用的模型暂时不可用，恢复后会判出来。',
    'sources-disabled': '数据源未开启',
    'collection-failed': '采集失败',
    'never-ran': '还没跑过',
    stale: '数据已过期 · 最后更新 {time}',
    quiet: '这段时间没有相关消息'
  }
},
  'en-US': {
  aiInterpretation: {
    title: 'How this story affects the market',
    info: 'Which assets this story affects and how; when it affects nothing, it says so too.',
    infoAria: 'What this section explains',
    readFailed: 'This interpretation could not be read; try again',
    generating: 'Generating',
    readResult: 'Read result',
    menuUnreadable: 'This interpretation cannot be read right now',
    unreachable: 'The request did not reach the analysis service; try again',
    runFailed: 'The interpretation ran but produced no result; try again',
    // Waited past the 3-minute limit with no result (server stuck, or the app closed mid-run).
    waitExceeded: 'The run did not finish in time; try again',
    retry: 'Try again',
    meta: 'Generated {time} · Based on: this story + the data available when it was generated ({count} pieces of evidence)',
    audit: {
      summary: 'Audit details',
      asOf: 'Analyzed at',
      dataCutoff: 'Data cutoff',
      factCount: 'Facts',
      evidenceRefCount: 'Evidence refs',
      domains: 'Domains',
      runId: 'Analysis run',
      snapshotHash: 'Data version'
    }
  },
  newsSentiment: {
    unavailable: 'News sentiment is unavailable.',
    unjudged: 'New stories arrived, but none has been judged yet.',
    unjudgedModelOff: 'New stories arrived, but none has been judged yet — the model that judges news direction is off; turn it on in Sentiment settings and they will be judged.',
    unjudgedModelUnavailable: 'New stories arrived, but none has been judged yet — the model that judges news direction is unavailable right now; they will be judged once it is back.',
    'sources-disabled': 'Data sources are off',
    'collection-failed': 'Collection failed',
    'never-ran': "Hasn't run yet",
    stale: 'Data is out of date · last updated {time}',
    quiet: 'No related news in this period'
  }
}
} as const
