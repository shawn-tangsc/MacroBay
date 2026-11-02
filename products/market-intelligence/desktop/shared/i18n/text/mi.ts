/* 只搬位置，不改句子：本条文案归这个文件独占，改之前先看清它属于哪条线。 */
export const miText = {
  'zh-CN': {
  newsSentiment: {
    unavailable: '舆情暂时不可用。',
    'sources-disabled': '数据源未开启',
    'collection-failed': '采集失败',
    'never-ran': '还没跑过',
    stale: '数据已过期 · 最后更新 {time}',
    quiet: '这段时间没有相关消息'
  }
},
  'en-US': {
  newsSentiment: {
    unavailable: 'News sentiment is unavailable.',
    'sources-disabled': 'Data sources are off',
    'collection-failed': 'Collection failed',
    'never-ran': "Hasn't run yet",
    stale: 'Data is out of date · last updated {time}',
    quiet: 'No related news in this period'
  }
}
} as const
