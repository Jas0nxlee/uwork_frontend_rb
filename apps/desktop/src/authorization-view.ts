/** Main-owned, disposable browser surface for product-selected authorization adapters. */
import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { session, WebContentsView, type View, type WebFrameMain } from 'electron'
import type { PlatformBounds } from './platform-view.ts'

/** Private authorization navigation data; never send this object to the application renderer. */
export interface NativeAuthorizationNavigation {
  readonly authorizationUrl: string
  readonly callbackUrl: string
  readonly allowedNavigationOrigins: readonly string[]
}

/** Application window owning the temporary authorization surface. */
export type AuthorizationOwner = Pick<EventEmitter, 'on' | 'removeListener'> & {
  readonly webContents: Pick<EventEmitter, 'on' | 'removeListener'> & { readonly mainFrame: WebFrameMain }
  readonly contentView: Pick<View, 'addChildView' | 'removeChildView'>
  isDestroyed(): boolean
}

function https(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid authorization destination')
  return url
}

/** Restrict navigation and bind the callback's fixed query parameters to the private attempt. */
export class AuthorizationNavigationPolicy {
  private readonly origins: ReadonlySet<string>
  private readonly callback: URL
  readonly initialUrl: string

  /**
   * @param navigation - trusted adapter output, revalidated before creating any browser resource.
   */
  constructor(navigation: NativeAuthorizationNavigation) {
    const initial = https(navigation.authorizationUrl)
    this.callback = https(navigation.callbackUrl)
    this.origins = new Set(navigation.allowedNavigationOrigins.map((value) => {
      const url = https(value)
      if (url.href !== `${url.origin}/`) throw new Error('Invalid authorization origin')
      return url.origin
    }))
    if (!this.origins.has(initial.origin)) throw new Error('Authorization origin not allowed')
    this.initialUrl = initial.href
  }

  /**
   * @param value - attempted destination.
   * @returns whether this is the attempt-bound callback.
   */
  isCallback(value: string): boolean {
    try {
      const url = https(value)
      return url.origin === this.callback.origin && url.pathname === this.callback.pathname
        && [...this.callback.searchParams].every(([key, expected]) => {
          const values = url.searchParams.getAll(key)
          return values.length === 1 && values[0] === expected
        })
    } catch { return false }
  }

  /**
   * @param value - attempted destination.
   * @returns whether the provider may display it.
   */
  allows(value: string): boolean {
    try {
      const url = https(value)
      if (url.origin === this.callback.origin && url.pathname === this.callback.pathname) return false
      return this.origins.has(url.origin)
    } catch { return false }
  }
}

/** One attempt owns one memory partition, browser document and abortable callback. */
export class DesktopAuthorizationView {
  private release: (() => void) | undefined
  private readonly cleanup = new Set<Promise<void>>()
  private disposed = false
  private generation = 0

  /**
   * @param owner - application window owning this attempt.
   * @param sender - Electron sender of the open request; only the owner's exact main frame is accepted.
   * @param navigation - Main-only navigation supplied by the selected Host adapter.
   * @param bounds - validated content rectangle.
   * @param complete - private callback consumer; authorization codes never traverse renderer IPC.
   * @param cancelled - informs the adapter when the surface is withdrawn before callback delivery.
   * @returns after the provider document loads; closeAndWait owns later cleanup.
   */
  async open(owner: AuthorizationOwner, sender: { sender: object; senderFrame: WebFrameMain | null },
    navigation: NativeAuthorizationNavigation, bounds: PlatformBounds,
    complete: (url: string, signal: AbortSignal) => Promise<void>, cancelled: () => void): Promise<void> {
    if (sender.sender !== owner.webContents || sender.senderFrame !== owner.webContents.mainFrame) throw new Error('Rejected authorization owner')
    if (this.unavailable(owner)) throw new Error('Authorization surface unavailable')
    const policy = new AuthorizationNavigationPolicy(navigation)
    const generation = ++this.generation
    this.release?.()
    await this.drainCleanup()
    if (generation !== this.generation || this.unavailable(owner)) throw new Error('Authorization surface unavailable')
    const ownerContents = owner.webContents
    const browserSession = session.fromPartition(`dsh-authorization-${randomUUID()}`, { cache: false })
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    const download = (event: Electron.Event) => { event.preventDefault() }
    browserSession.on('will-download', download)
    const view = new WebContentsView({ webPreferences: {
      session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, devTools: false, webviewTag: false,
    } })
    const abort = new AbortController()
    const navigationState = { callbackDelivered: false, released: false }
    const close = () => {
      if (navigationState.released) return
      navigationState.released = true
      this.release = undefined
      abort.abort()
      owner.removeListener('closed', close)
      for (const event of ['destroyed', 'render-process-gone']) ownerContents.removeListener(event, close)
      ownerContents.removeListener('did-start-navigation', ownerNavigation)
      browserSession.removeListener('will-download', download)
      if (!owner.isDestroyed()) owner.contentView.removeChildView(view)
      const destroyed = new Promise<void>((resolve) => {
        if (view.webContents.isDestroyed()) resolve()
        else { view.webContents.once('destroyed', resolve); view.webContents.close({ waitForBeforeUnload: false }) }
      })
      const task = destroyed.then(async () => {
        await browserSession.closeAllConnections()
        await Promise.all([browserSession.clearStorageData(), browserSession.clearCache(), browserSession.clearAuthCache()])
      })
      // Observe immediately; closeAndWait reports failures to the shell lifecycle owner.
      void task.catch((_error: unknown) => { /* closeAndWait reports storage failures. */ })
      this.cleanup.add(task)
      if (!navigationState.callbackDelivered) cancelled()
    }
    const ownerNavigation = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) close()
    }
    this.release = close
    owner.on('closed', close)
    for (const event of ['destroyed', 'render-process-gone']) ownerContents.on(event, close)
    ownerContents.on('did-start-navigation', ownerNavigation)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
    view.webContents.on('render-process-gone', close)
    const navigate = (event: Electron.Event, url: string, _inPlace?: boolean, isMainFrame = true) => {
      if (policy.isCallback(url)) {
        event.preventDefault()
        if (!isMainFrame || navigationState.released || navigationState.callbackDelivered) return
        navigationState.callbackDelivered = true
        const task = complete(url, abort.signal).finally(close)
        void task.catch((_error: unknown) => { /* closeAndWait reports callback failures. */ })
        this.cleanup.add(task)
      } else if (!policy.allows(url)) event.preventDefault()
    }
    view.webContents.on('will-navigate', navigate)
    view.webContents.on('will-redirect', navigate)
    owner.contentView.addChildView(view)
    view.setBounds(bounds)
    try { await view.webContents.loadURL(policy.initialUrl) }
    catch (error) {
      if (!navigationState.released
        && !(error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED' && navigationState.callbackDelivered)) {
        close()
        throw new Error('Authorization document unavailable')
      }
    }
  }

  /** Withdraw the browser immediately; closeAndWait subsequently reports cleanup failures. */
  close(): void { this.generation++; this.release?.() }

  /** Destroy the browser and await callback settlement and storage removal. */
  async closeAndWait(): Promise<void> {
    this.close()
    await this.drainCleanup()
  }

  private async drainCleanup(): Promise<void> {
    const tasks = [...this.cleanup]
    const results = await Promise.allSettled(tasks)
    for (const task of tasks) this.cleanup.delete(task)
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map((result): unknown => result.reason), 'Authorization cleanup failed')
  }

  /** Refuse future attempts and await all private browser resources. */
  async dispose(): Promise<void> { this.disposed = true; await this.closeAndWait() }

  private unavailable(owner: AuthorizationOwner): boolean { return this.disposed || owner.isDestroyed() }
}
