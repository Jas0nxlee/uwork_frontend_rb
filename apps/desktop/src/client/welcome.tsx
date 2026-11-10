/** Mount the local React renderer before Electron reveals the welcome window. */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Welcome } from './WelcomePage.tsx'
import type { WelcomeApi } from '../welcome-api.ts'
import type { NativeAuthorizationApi } from '../native-authorization-api.ts'
import { NativeAuthorizationPage } from './NativeAuthorizationPage.tsx'
import { nativeAuthorizationMessages } from '../native-authorization-locale.ts'

declare global {
  interface Window {
    dshWelcome: WelcomeApi
    dshNativeAuthorization?: NativeAuthorizationApi
  }
}

const container = document.getElementById('root')
if (container === null) throw new Error('desktop welcome: missing React root')
const root = createRoot(container)
async function mountWelcome(): Promise<void> {
  const nativeApi = window.dshNativeAuthorization
  let initial
  try { initial = nativeApi === undefined ? null : await nativeApi.state() }
  catch (_error: unknown) {
    const m = nativeAuthorizationMessages(window.dshWelcome.id)
    root.render(<main className="native-authorization"><h1>{m.title}</h1><p role="alert">{m.failed}</p>
      <div className="native-authorization-actions"><button className="primary" type="button" onClick={() => { void mountWelcome() }}>{m.retry}</button></div></main>)
    return
  }
  flushSync(() => {
    root.render(initial === null || nativeApi === undefined ? <Welcome api={window.dshWelcome} />
      : <NativeAuthorizationPage api={nativeApi} initial={initial} locale={window.dshWelcome.id} />)
  })
}
void mountWelcome()
window.addEventListener('pagehide', () => { root.unmount() }, { once: true })
