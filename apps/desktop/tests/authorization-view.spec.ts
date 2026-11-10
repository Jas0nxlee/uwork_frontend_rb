import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebFrameMain } from 'electron'
import { AuthorizationNavigationPolicy, DesktopAuthorizationView } from '../src/authorization-view.ts'

const state = vi.hoisted(() => ({
  views: [] as MockView[], partitions: [] as string[], load: undefined as ((view: MockView) => Promise<void>) | undefined,
}))
class MockView {
  webContents = Object.assign(new EventEmitter(), {
    session: undefined as MockSession | undefined,
    isDestroyed: (): boolean => false,
    close: vi.fn(() => { this.webContents.emit('destroyed') }),
    loadURL: vi.fn(async (_url: string) => { await state.load?.(this) }),
    setWindowOpenHandler: vi.fn((_handler: () => { action: string }) => {}),
  })
  setBounds = vi.fn()
  constructor(readonly options: { webPreferences: { session: MockSession } }) {
    this.webContents.session = options.webPreferences.session
    state.views.push(this)
  }
}
class MockSession extends EventEmitter {
  setPermissionRequestHandler = vi.fn(
    (_handler: (contents: object, permission: string, callback: (allowed: boolean) => void) => void) => {})
  setPermissionCheckHandler = vi.fn((_handler: () => boolean) => {})
  closeAllConnections = vi.fn(async () => {})
  clearStorageData = vi.fn(async () => {})
  clearCache = vi.fn(async () => {})
  clearAuthCache = vi.fn(async () => {})
}
vi.mock('electron', () => ({
  session: { fromPartition: (partition: string) => { state.partitions.push(partition); return new MockSession() } },
  get WebContentsView() { return MockView },
}))
afterEach(() => { state.views.length = 0; state.partitions.length = 0; state.load = undefined; vi.clearAllMocks() })
const navigation = {
  authorizationUrl: 'https://login.example/sso', callbackUrl: 'https://callback.example/complete?nonce=owned',
  allowedNavigationOrigins: ['https://login.example'],
}
const bounds = { x: 0, y: 0, width: 600, height: 500 }
function setup() {
  const frame = {} as WebFrameMain
  const owner = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { mainFrame: frame }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, isDestroyed: (): boolean => false,
  })
  return { owner, sender: { sender: owner.webContents, senderFrame: frame }, manager: new DesktopAuthorizationView() }
}
function view() { return state.views.at(-1)! }

it('accepts only exact configured origins and a single matching callback nonce', () => {
  const policy = new AuthorizationNavigationPolicy(navigation)
  expect(policy.allows('https://login.example/sso/continue')).toBe(true)
  for (const url of ['http://login.example', 'https://login.example.evil', 'https://user@login.example', 'file:///tmp/a']) expect(policy.allows(url)).toBe(false)
  expect(policy.isCallback('https://callback.example/complete?nonce=owned&code=private')).toBe(true)
  const withCallbackOrigin = new AuthorizationNavigationPolicy({ ...navigation, allowedNavigationOrigins: [...navigation.allowedNavigationOrigins, 'https://callback.example'] })
  expect(withCallbackOrigin.allows('https://callback.example/complete?nonce=other&code=private')).toBe(false)
  for (const query of ['nonce=other', 'nonce=owned&nonce=other']) expect(policy.isCallback(`https://callback.example/complete?${query}`)).toBe(false)
  expect(() => new AuthorizationNavigationPolicy({ ...navigation, allowedNavigationOrigins: ['https://login.example/path'] })).toThrow()
})

it('rejects unowned and child frames before creating browser resources', async () => {
  const { manager, owner, sender } = setup()
  for (const event of [{ ...sender, sender: {} }, { ...sender, senderFrame: {} as WebFrameMain }]) {
    await expect(manager.open(owner, event, navigation, bounds, vi.fn(), vi.fn())).rejects.toThrow('owner')
  }
  expect(state.views).toHaveLength(0)
})

it('uses a private sandboxed memory partition and blocks windows, downloads and untrusted navigation', async () => {
  const { manager, owner, sender } = setup()
  await manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  expect(state.partitions[0]).toMatch(/^dsh-authorization-/)
  expect(view().options.webPreferences).toMatchObject({
    sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, webviewTag: false,
  })
  expect(view().webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
  for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    const event = { preventDefault: vi.fn() }
    view().webContents.emit(name, event, 'https://evil.example')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  }
  const event = { preventDefault: vi.fn() }
  view().webContents.session!.emit('will-download', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  await manager.dispose()
  expect(view().webContents.session!.clearStorageData).toHaveBeenCalledOnce()
})

it('delivers callback only once to the private consumer and destroys storage after settlement', async () => {
  const { manager, owner, sender } = setup()
  const complete = vi.fn(async (_url: string, _signal: AbortSignal) => {})
  const cancelled = vi.fn()
  await manager.open(owner, sender, navigation, bounds, complete, cancelled)
  const event = { preventDefault: vi.fn() }
  view().webContents.emit('will-redirect', event, 'https://callback.example/complete?nonce=owned&code=private', false, false)
  expect(complete).not.toHaveBeenCalled()
  view().webContents.emit('will-redirect', event, 'https://callback.example/complete?nonce=owned&code=private', false, true)
  view().webContents.emit('will-navigate', event, 'https://callback.example/complete?nonce=owned&code=private')
  await manager.closeAndWait()
  expect(complete).toHaveBeenCalledOnce()
  expect(cancelled).not.toHaveBeenCalled()
  expect(view().webContents.close).toHaveBeenCalledOnce()
  expect(view().webContents.session!.clearStorageData).toHaveBeenCalledOnce()
})

it.each(['closed', 'navigation', 'render-process-gone'])('withdraws on owner %s and rejects future opens after disposal', async (eventName) => {
  const { manager, owner, sender } = setup()
  const cancelled = vi.fn()
  await manager.open(owner, sender, navigation, bounds, vi.fn(), cancelled)
  if (eventName === 'closed') owner.emit('closed')
  else if (eventName === 'navigation') owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  else owner.webContents.emit(eventName)
  await manager.dispose()
  expect(cancelled).toHaveBeenCalledOnce()
  expect(owner.listenerCount('closed')).toBe(0)
  expect(owner.webContents.listenerCount('did-start-navigation')).toBe(0)
  await expect(manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())).rejects.toThrow('unavailable')
})

it('aborts an intercepted callback and awaits its settlement when the owner closes', async () => {
  const { manager, owner, sender } = setup()
  let callbackSignal: AbortSignal | undefined
  const complete = vi.fn((_url: string, signal: AbortSignal) => new Promise<void>((resolve) => {
    callbackSignal = signal
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  }))
  await manager.open(owner, sender, navigation, bounds, complete, vi.fn())
  view().webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://callback.example/complete?nonce=owned&code=private', false, true)
  expect(callbackSignal?.aborted).toBe(false)
  owner.emit('closed')
  await manager.dispose()
  expect(callbackSignal?.aborted).toBe(true)
  expect(view().webContents.session!.clearStorageData).toHaveBeenCalledOnce()
})

it('reports failed storage removal to the lifecycle owner', async () => {
  const { manager, owner, sender } = setup()
  await manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  view().webContents.session!.clearStorageData.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(manager.dispose()).rejects.toThrow('Authorization cleanup failed')
})

it('rejects invalid initial destinations and malformed callbacks before creating a view', () => {
  expect(() => new AuthorizationNavigationPolicy({ ...navigation, allowedNavigationOrigins: [] })).toThrow('not allowed')
  const policy = new AuthorizationNavigationPolicy(navigation)
  expect(policy.isCallback('not a URL')).toBe(false)
  expect(policy.isCallback('https://callback.example/elsewhere?nonce=owned')).toBe(false)
})

it('denies permissions and allows configured provider navigation without withdrawing on in-page owner changes', async () => {
  const { manager, owner, sender } = setup()
  await manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  const session = view().webContents.session!
  const answer = vi.fn()
  session.setPermissionRequestHandler.mock.calls[0]![0]({}, 'camera', answer)
  expect(answer).toHaveBeenCalledWith(false)
  expect(session.setPermissionCheckHandler.mock.calls[0]![0]()).toBe(false)
  const event = { preventDefault: vi.fn() }
  view().webContents.emit('will-navigate', event, 'https://login.example/next')
  expect(event.preventDefault).not.toHaveBeenCalled()
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/#section', true, true)
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app/frame', false, false)
  expect(view().webContents.close).not.toHaveBeenCalled()
  await manager.dispose()
})

it('does not detach from destroyed owners and clears storage for an already destroyed guest', async () => {
  const { manager, owner, sender } = setup()
  await manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  vi.spyOn(owner, 'isDestroyed').mockReturnValue(true)
  vi.spyOn(view().webContents, 'isDestroyed').mockReturnValue(true)
  owner.emit('closed')
  await manager.dispose()
  expect(owner.contentView.removeChildView).not.toHaveBeenCalled()
  expect(view().webContents.session!.clearStorageData).toHaveBeenCalledOnce()
})

it('refuses owners destroyed before resource admission and attempts superseded during cleanup', async () => {
  const first = setup()
  vi.spyOn(first.owner, 'isDestroyed').mockReturnValue(true)
  await expect(first.manager.open(first.owner, first.sender, navigation, bounds, vi.fn(), vi.fn())).rejects.toThrow('unavailable')
  const { manager, owner, sender } = setup()
  const old = manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  const rejected = expect(old).rejects.toThrow('unavailable')
  const next = manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  await rejected; await next
  expect(state.views).toHaveLength(1)
  await manager.dispose()
})

it('refuses disposal or owner destruction that occurs while waiting for cleanup', async () => {
  for (const kind of ['dispose', 'destroyed']) {
    const { manager, owner, sender } = setup()
    const task = manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
    const rejected = expect(task).rejects.toThrow('unavailable')
    if (kind === 'dispose') await manager.dispose()
    else vi.spyOn(owner, 'isDestroyed').mockReturnValue(true)
    await rejected
    await manager.dispose()
  }
})

it.each([new Error('failed'), Object.assign(new Error('failed'), { code: 'ERR_FAILED' }), Object.assign(new Error('aborted without callback'), { code: 'ERR_ABORTED' }), 'opaque failure'])('contains document-load failure without leaking its destination or diagnostics: %s', async (error) => {
  const { manager, owner, sender } = setup()
  state.load = async () => { throw error }
  await expect(manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())).rejects.toThrow('Authorization document unavailable')
  await manager.dispose()
})

it('accepts the initial load abort caused by intercepting its callback and ignores late load errors after withdrawal', async () => {
  const { manager, owner, sender } = setup()
  let finish!: () => void
  const complete = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  state.load = async (current) => {
    current.webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://callback.example/complete?nonce=owned&code=private', false, true)
    throw Object.assign(new Error('intercepted'), { code: 'ERR_ABORTED' })
  }
  await manager.open(owner, sender, navigation, bounds, complete, vi.fn())
  finish()
  await manager.closeAndWait()
  view().webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://callback.example/complete?nonce=owned&code=late', false, true)
  expect(complete).toHaveBeenCalledOnce()
  state.load = async () => { manager.close(); throw new Error('late') }
  await manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  await manager.dispose()
})

it('reports private callback failure through lifecycle cleanup', async () => {
  const { manager, owner, sender } = setup()
  await manager.open(owner, sender, navigation, bounds, async () => { throw new Error('exchange unavailable') }, vi.fn())
  view().webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://callback.example/complete?nonce=owned&code=private', false, true)
  await expect(manager.dispose()).rejects.toThrow('Authorization cleanup failed')
})

it('does not access BrowserWindow webContents after its native window is destroyed', async () => {
  const { manager, owner, sender } = setup()
  await manager.open(owner, sender, navigation, bounds, vi.fn(), vi.fn())
  vi.spyOn(owner, 'isDestroyed').mockReturnValue(true)
  Object.defineProperty(owner, 'webContents', { get: () => { throw new Error('Object has been destroyed') } })
  owner.emit('closed')
  await manager.dispose()
  expect(view().webContents.close).toHaveBeenCalledOnce()
  expect(view().webContents.session!.clearStorageData).toHaveBeenCalledOnce()
})
