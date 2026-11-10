import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { WebFrameMain } from 'electron'
import type { NativeAuthorizationProvider, NativeAuthorizationAttemptId } from '@deepseek-ai/dsh-native-authorization/types'
import { NativeAuthorizationController } from '../src/native-authorization-controller.ts'
import { NATIVE_AUTHORIZATION_IPC } from '../src/native-authorization-api.ts'
const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  open: vi.fn(async (_owner: object, _event: object, _attempt: object, _bounds: object,
    _complete: (url: string, signal: AbortSignal) => Promise<void>, _cancelled: () => void) => {}),
  close: vi.fn(), closeAndWait: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
}))
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, fn: (...args: never[]) => unknown) => { state.handlers.set(channel, fn) },
  removeHandler: (channel: string) => { state.handlers.delete(channel) },
} }))
vi.mock('../src/platform-view.ts', () => ({ platformBounds: (value: { width: number }) => {
  if (value.width < 0) throw new Error('Invalid bounds')
  return value
} }))
vi.mock('../src/authorization-view.ts', () => ({ DesktopAuthorizationView: class {
  open = state.open; close = state.close; closeAndWait = state.closeAndWait; dispose = state.dispose
} }))
afterEach(() => { state.handlers.clear(); vi.clearAllMocks() })
const id = 'owned' as NativeAuthorizationAttemptId
const safe = { status: 'pending' as const, choices: [{ id: 'org', label: 'Organization' }], attempt: { id, expiresAt: 123 } }
const attempt = { id, expiresAt: 123, authorizationUrl: 'https://login.example', callbackUrl: 'https://callback.example?nonce=owned', allowedNavigationOrigins: ['https://login.example'] }
function setup(enabled = true) {
  const provider: NativeAuthorizationProvider = {
    getState: vi.fn(async () => safe), start: vi.fn(async () => attempt), poll: vi.fn(async () => safe),
    complete: vi.fn(async () => safe), cancel: vi.fn(async () => safe),
  }
  const frame = {} as WebFrameMain
  const owner = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { mainFrame: frame }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, isDestroyed: () => false,
  })
  const event = { sender: owner.webContents, senderFrame: frame }
  const admitted = vi.fn(async () => {})
  const controller = new NativeAuthorizationController(enabled ? provider : undefined, admitted)
  controller.attach(owner)
  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = state.handlers.get(channel)! as (...args: unknown[]) => unknown
    return Promise.resolve().then(() => handler(event, ...args))
  }
  return { controller, provider, owner, event, admitted, invoke }
}
it('returns null for standard products and rejects child or foreign renderer frames', async () => {
  const { controller, event, invoke } = setup(false)
  expect(await invoke(NATIVE_AUTHORIZATION_IPC.state)).toBeNull()
  event.senderFrame = {} as WebFrameMain
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.state)).rejects.toThrow('sender')
  await controller.dispose()
  expect(state.handlers.size).toBe(0)
})
it('keeps attempt navigation in Main and exposes only safe progress to the renderer', async () => {
  const { controller, provider, event, invoke } = setup()
  expect(await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })).toEqual(safe)
  expect(state.open).toHaveBeenCalledWith(expect.anything(), event, attempt, expect.anything(), expect.any(Function), expect.any(Function))
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.cancel, 'other')).rejects.toThrow('attempt')
  await invoke(NATIVE_AUTHORIZATION_IPC.cancel, id)
  expect(provider.cancel).toHaveBeenCalledWith(id)
  await controller.dispose()
})
it('revokes closed owners and refuses invalid bounds before starting an attempt', async () => {
  const { controller, provider, owner, invoke } = setup()
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { width: -1 })).rejects.toThrow('bounds')
  expect(provider.start).not.toHaveBeenCalled()
  owner.emit('closed')
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.state)).rejects.toThrow('sender')
  await controller.dispose()
})

it('withdraws an in-flight Host start when its owner closes and awaits it before disposal', async () => {
  const { controller, provider, owner, invoke } = setup()
  let began!: () => void
  const started = new Promise<void>((resolve) => { began = resolve })
  let signal: AbortSignal | undefined
  vi.mocked(provider.start).mockImplementation((_choice, next) => new Promise((_resolve, reject) => {
    signal = next; began()
    next.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
  }))
  const task = invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  const rejected = expect(task).rejects.toThrow('withdrawn')
  await started
  owner.emit('closed')
  await rejected
  await controller.dispose()
  expect(signal?.aborted).toBe(true)
  expect(owner.webContents.listenerCount('did-start-navigation')).toBe(0)
  expect(state.open).not.toHaveBeenCalled()
})

it('closes the QR surface when polling reports expiry', async () => {
  const { controller, provider, invoke } = setup()
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  vi.mocked(provider.poll).mockResolvedValue({ status: 'signed-out', choices: safe.choices, error: 'expired' })
  expect(await invoke(NATIVE_AUTHORIZATION_IPC.poll, id)).toMatchObject({ error: 'expired' })
  expect(state.closeAndWait).toHaveBeenCalled()
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.cancel, id)).rejects.toThrow('attempt')
  await controller.dispose()
})

it('admits verified callback completion exactly once and keeps pending results out of the workspace', async () => {
  const { controller, provider, admitted, invoke } = setup()
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  const complete = state.open.mock.calls[0]![4]
  await complete('https://callback.example?code=private', new AbortController().signal)
  expect(admitted).not.toHaveBeenCalled()
  vi.mocked(provider.complete).mockResolvedValue({ status: 'signed-in', choices: safe.choices })
  await complete('https://callback.example?code=private', new AbortController().signal)
  expect(admitted).toHaveBeenCalledOnce()
  await complete('https://callback.example?code=replayed', new AbortController().signal)
  expect(admitted).toHaveBeenCalledOnce()
  await controller.dispose()
})

it('withdraws the Host attempt when the surface closes and observes cancellation failures', async () => {
  const { controller, provider, invoke } = setup()
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  vi.mocked(provider.cancel).mockRejectedValueOnce(new Error('Host closed'))
  const cancelled = state.open.mock.calls[0]![5]
  cancelled()
  cancelled()
  await controller.dispose()
  expect(provider.cancel).toHaveBeenCalledOnce()
})

it('contains document-load failure and withdraws only the failed generation', async () => {
  const { controller, provider, invoke } = setup()
  state.open.mockRejectedValueOnce(new Error('load failed'))
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  await controller.dispose()
  expect(provider.cancel).toHaveBeenCalledWith(id)
})

it('does not withdraw a replaced surface when its old load later fails', async () => {
  const { controller, invoke } = setup()
  let reject!: (error: Error) => void
  state.open.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  await invoke(NATIVE_AUTHORIZATION_IPC.cancel, id)
  reject(new Error('old load failed'))
  await controller.dispose()
})

it('admits successful handoff polling and rejects attempts unavailable to this product', async () => {
  const { controller, provider, admitted, invoke, owner } = setup()
  expect(controller.attach(owner)).toBe(controller.attach(owner))
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  expect(await invoke(NATIVE_AUTHORIZATION_IPC.poll, id)).toEqual(safe)
  vi.mocked(provider.poll).mockResolvedValue({ status: 'signed-in', choices: safe.choices })
  await invoke(NATIVE_AUTHORIZATION_IPC.poll, id)
  expect(admitted).toHaveBeenCalledOnce()
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.poll, 'unknown')).rejects.toThrow('attempt')
  await controller.dispose()
  const standard = setup(false)
  await expect(standard.invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', {})).rejects.toThrow('choice')
  await standard.controller.dispose()
})

it('rejects invalid choices and blocking shell policy', async () => {
  const { controller, invoke, owner } = setup()
  for (const choice of ['', 'x'.repeat(257), 123]) await expect(invoke(NATIVE_AUTHORIZATION_IPC.start, choice, {})).rejects.toThrow('choice')
  await controller.dispose()
  const blocked = new NativeAuthorizationController(undefined, async () => {}, () => true)
  blocked.attach(owner)
  const handler = state.handlers.get(NATIVE_AUTHORIZATION_IPC.start)! as (...args: unknown[]) => unknown
  await expect(handler({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame }, 'org', {})).rejects.toThrow('policy')
  await blocked.dispose()
})

it('aborts pending starts on owner navigation and cancels late successful start replies', async () => {
  const { controller, provider, owner, invoke } = setup()
  let began!: () => void
  const started = new Promise<void>((resolve) => { began = resolve })
  let finish!: (value: typeof attempt) => void
  vi.mocked(provider.start).mockImplementation(() => new Promise((resolve) => { finish = resolve; began() }))
  const task = invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  const rejected = expect(task).rejects.toThrow('withdrawn')
  await started
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app', true, true)
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app', false, false)
  owner.webContents.emit('did-start-navigation', {}, 'dsh-app://app', false, true)
  finish(attempt)
  await rejected
  expect(provider.cancel).toHaveBeenCalledWith(id)
  await controller.dispose()
})

it('cancels a superseded in-flight start before opening its late reply', async () => {
  const { controller, provider, invoke } = setup()
  let began!: () => void
  const started = new Promise<void>((resolve) => { began = resolve })
  let finish!: (value: typeof attempt) => void
  vi.mocked(provider.start).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; began() }))
  const first = invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  const rejected = expect(first).rejects.toThrow('withdrawn')
  await started
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  finish(attempt)
  await rejected
  expect(state.open).toHaveBeenCalledOnce()
  await controller.dispose()
})

it('rechecks shell admission after the Host has prepared the private attempt', async () => {
  const h = setup()
  await h.controller.dispose()
  let blocked = false
  const controller = new NativeAuthorizationController(h.provider, async () => {}, () => blocked)
  controller.attach(h.owner)
  vi.mocked(h.provider.start).mockImplementation(async () => { blocked = true; return attempt })
  await expect(h.invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })).rejects.toThrow('withdrawn')
  expect(h.provider.cancel).toHaveBeenCalledWith(id)
  expect(state.open).not.toHaveBeenCalled()
  await controller.dispose()
})

it('withdraws a retired attempt when state recovery follows a failed expiry poll', async () => {
  const { controller, provider, invoke } = setup()
  await invoke(NATIVE_AUTHORIZATION_IPC.start, 'org', { x: 0, y: 0, width: 500, height: 400 })
  provider.poll = vi.fn(async () => {
    vi.mocked(provider.getState).mockResolvedValue({ status: 'signed-out', choices: safe.choices, error: 'expired' })
    throw new Error('Attempt expired')
  })
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.poll, id)).rejects.toThrow('expired')
  state.closeAndWait.mockClear()
  expect(await invoke(NATIVE_AUTHORIZATION_IPC.state)).toMatchObject({ status: 'signed-out', error: 'expired' })
  expect(state.closeAndWait).toHaveBeenCalledOnce()
  await expect(invoke(NATIVE_AUTHORIZATION_IPC.cancel, id)).rejects.toThrow('attempt')
  await controller.dispose()
})

it('keeps pending state visible and does not repeat workspace admission for an initially signed-in provider', async () => {
  const { controller, provider, admitted, invoke } = setup()
  expect(await invoke(NATIVE_AUTHORIZATION_IPC.state)).toEqual(safe)
  expect(state.closeAndWait).not.toHaveBeenCalled()
  vi.mocked(provider.getState).mockResolvedValue({ status: 'signed-in', choices: safe.choices })
  expect(await invoke(NATIVE_AUTHORIZATION_IPC.state)).toMatchObject({ status: 'signed-in' })
  expect(admitted).not.toHaveBeenCalled()
  await controller.dispose()
})
