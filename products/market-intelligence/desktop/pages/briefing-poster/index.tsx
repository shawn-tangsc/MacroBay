import BriefingPosterWindow from '../intelligence/BriefingPosterWindow'

/**
 * 一次性窗口入口：主进程的隐藏窗口加载它，只画海报、不挂壳层。
 *
 * 壳层按「窗口入口」的约定调用默认导出，参数是启动参数；这里不解释参数（版次三件套的解析
 * 在 `BriefingPosterWindow` 里），也不碰壳层状态——窗口用完就销毁。
 */
export default function BriefingPosterEntry({ params }: Readonly<{ params: URLSearchParams }>): React.ReactElement {
  return <BriefingPosterWindow params={params} />
}