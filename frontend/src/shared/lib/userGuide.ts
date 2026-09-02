import rawUserGuide from '../../../docs/USER_GUIDE.md?raw'
import uiOverviewUrl from '../../../docs/assets/ui-overview.svg?url'
import publicationsFlowUrl from '../../../docs/assets/publications-flow.svg?url'
import workspaceFlowUrl from '../../../docs/assets/workspace-flow.svg?url'

const normalizedGuide = rawUserGuide.replace(/\r\n/g, '\n').trim()
const titleMatch = normalizedGuide.match(/^#\s+(.+)$/m)

export const USER_GUIDE_TITLE = titleMatch?.[1] || 'Инструкция пользователя'
export const USER_GUIDE_MARKDOWN = normalizedGuide.replace(/^#\s+.+\n*/m, '').trim()

export const USER_GUIDE_ASSET_URLS: Record<string, string> = {
  './assets/ui-overview.svg': uiOverviewUrl,
  './assets/publications-flow.svg': publicationsFlowUrl,
  './assets/workspace-flow.svg': workspaceFlowUrl,
}