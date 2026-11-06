import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { platformText } from '../../i18n/platformText'

import { NotificationToasts } from './NotificationToasts'

/**
 * 外壳里的横幅挂载点：**就一行**。
 *
 * 存在的理由有两个，都不是「好看」：
 * 1. `AppShell` 是受保护接缝，文件体积门禁的基线只能降不能升——每加一个能力就往里塞几行，
 *    接缝迟早又变回什么都装的那份文件。所以文案与语言在这里取，外壳只负责「挂上」。
 * 2. 语言从上下文来，不在外壳里再传一遍：横幅里的句子必须跟着显示语言走，多一层传参就多一处能忘。
 */
export function NotificationBanner(props: { onOpen: () => void }): React.ReactElement {
  const language = useShellLanguage()
  return <NotificationToasts labels={platformText[language].notifications} onOpen={props.onOpen} />
}
