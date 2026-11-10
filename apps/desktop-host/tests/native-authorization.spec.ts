import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import NativeAuthorization from '@deepseek-ai/dsh-native-authorization'
import type { NativeAuthorizationAttempt, NativeAuthorizationAttemptId, NativeAuthorizationProvider, NativeAuthorizationState } from '@deepseek-ai/dsh-native-authorization/types'
import { describe, expect, it, vi } from 'vitest'
import { nativeAuthorizationBridge } from '../src/native-authorization.ts'

const signedOut: NativeAuthorizationState = { status: 'signed-out', choices: [] }
const id = brandString<NativeAuthorizationAttemptId>('attempt-one')
const attempt: NativeAuthorizationAttempt = {
  id, authorizationUrl: 'https://login.example/start', callbackUrl: 'https://login.example/callback',
  allowedNavigationOrigins: ['https://login.example'], expiresAt: 100,
}
const request = (requestId: number, action: string, fields: object = {}) => ({ type: 'native-authorization', requestId, action, ...fields })

function createProvider() {
  return {
    getState: vi.fn(async () => signedOut),
    start: vi.fn(async (_choice: string, _signal: AbortSignal) => attempt),
    complete: vi.fn(async (_id: NativeAuthorizationAttemptId, _url: string, _signal: AbortSignal) => signedOut),
    poll: vi.fn(async (_id: NativeAuthorizationAttemptId, _signal: AbortSignal) => signedOut),
    cancel: vi.fn(async (_id: NativeAuthorizationAttemptId) => signedOut),
  } satisfies NativeAuthorizationProvider
}

async function fixture(
  body: (bridge: ReturnType<typeof nativeAuthorizationBridge>, provider: ReturnType<typeof createProvider>,
    replies: object[], next: () => Promise<object>) => Promise<void>, mounted = true,
): Promise<void> {
  const ctx = new Context()
  const provider = createProvider()
  const scope = await ctx.plugin(NativeAuthorization)
  if (mounted) ctx.nativeAuthorization.register(provider)
  const replies: object[] = []
  let delivered = Promise.withResolvers<object>()
  const bridge = nativeAuthorizationBridge(Promise.resolve(ctx), async (reply) => {
    replies.push(reply)
    const current = delivered
    delivered = Promise.withResolvers<object>()
    current.resolve(reply)
  })
  try { await body(bridge, provider, replies, () => delivered.promise) }
  finally { await bridge.dispose(); await scope.dispose() }
}

describe('private native authorization Host bridge', () => {
  it('contains boot rejection before a native request and returns only the safe failure', async () => {
    const response = Promise.withResolvers<object>()
    const send = vi.fn(async (value: object) => { response.resolve(value) })
    const bridge = nativeAuthorizationBridge(Promise.reject(new Error('private boot diagnostic')), send)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(send).not.toHaveBeenCalled()
    bridge.handle(request(1, 'state'))
    expect(await response.promise).toEqual({ type: 'native-authorization', requestId: 1, error: 'Native authorization unavailable' })
    await bridge.dispose()
  })

  it('reports no provider safely and rejects unrelated or malformed requests', async () => {
    await fixture(async (bridge, provider, replies, next) => {
      expect(bridge.handle({ type: 'renderer-remote' })).toBe(false)
      expect(bridge.handle(request(NaN, 'state'))).toBe(true)
      bridge.handle(request(1, 'state'))
      expect(await next()).toEqual({ type: 'native-authorization', requestId: 1, value: null })
      const rejected = next()
      bridge.handle(request(2, 'start', { choiceId: 'org' }))
      expect(await rejected).toEqual({ type: 'native-authorization', requestId: 2, error: 'Native authorization unavailable' })
      expect(provider.start).not.toHaveBeenCalled()
      expect(replies).toHaveLength(2)
    }, false)
  })

  it('correlates overlapping requests and ignores duplicate live ids', async () => {
    await fixture(async (bridge, provider, replies, next) => {
      const blocked = Promise.withResolvers<NativeAuthorizationState>()
      vi.mocked(provider.getState).mockReturnValueOnce(blocked.promise)
      bridge.handle(request(1, 'state'))
      bridge.handle(request(1, 'start', { choiceId: 'duplicate' }))
      bridge.handle(request(2, 'state'))
      expect(await next()).toMatchObject({ requestId: 2, value: signedOut })
      blocked.resolve(signedOut)
      expect(await next()).toMatchObject({ requestId: 1, value: signedOut })
      expect(provider.start).not.toHaveBeenCalled()
      expect(replies).toHaveLength(2)
    })
  })

  it('cancels a late start result and waits for cancellation before replying', async () => {
    await fixture(async (bridge, provider, replies, next) => {
      const started = Promise.withResolvers<undefined>()
      const result = Promise.withResolvers<NativeAuthorizationAttempt>()
      const cancelled = Promise.withResolvers<undefined>()
      const drained = Promise.withResolvers<NativeAuthorizationState>()
      vi.mocked(provider.start).mockImplementation(async (_choice, signal) => {
        started.resolve(undefined)
        await result.promise
        expect(signal.aborted).toBe(true)
        return attempt
      })
      vi.mocked(provider.cancel).mockImplementation(async () => { cancelled.resolve(undefined); return drained.promise })
      bridge.handle(request(1, 'start', { choiceId: 'org' }))
      await started.promise
      bridge.handle({ type: 'native-authorization-cancel-request', requestId: 1 })
      result.resolve(attempt)
      await cancelled.promise
      expect(replies).toEqual([])
      drained.resolve(signedOut)
      expect(await next()).toMatchObject({ requestId: 1, error: 'Native authorization unavailable' })
      expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
    })
  })

  it('disposes an already returned attempt and waits for provider quiescence', async () => {
    await fixture(async (bridge, provider, _replies, next) => {
      bridge.handle(request(1, 'start', { choiceId: 'org' }))
      await next()
      const cancelled = Promise.withResolvers<undefined>()
      const drained = Promise.withResolvers<NativeAuthorizationState>()
      vi.mocked(provider.cancel).mockImplementation(async () => { cancelled.resolve(undefined); return drained.promise })
      const disposed = vi.fn()
      const closing = bridge.dispose().then(disposed)
      await cancelled.promise
      expect(disposed).not.toHaveBeenCalled()
      drained.resolve(signedOut)
      await closing
      expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
      const rejected = next()
      bridge.handle(request(2, 'start', { choiceId: 'org' }))
      expect(await rejected).toMatchObject({ requestId: 2, error: 'Native authorization unavailable' })
      expect(provider.start).toHaveBeenCalledTimes(1)
    })
  })

  it('withdraws an owned poll immediately on request abort and drains its cancellation', async () => {
    await fixture(async (bridge, provider, replies, next) => {
      bridge.handle(request(1, 'start', { choiceId: 'org' }))
      await next()
      const polling = Promise.withResolvers<undefined>()
      const cancelled = Promise.withResolvers<undefined>()
      const pollResult = Promise.withResolvers<NativeAuthorizationState>()
      const drained = Promise.withResolvers<NativeAuthorizationState>()
      vi.mocked(provider.poll).mockImplementation(async () => { polling.resolve(undefined); return pollResult.promise })
      vi.mocked(provider.cancel).mockImplementation(async () => { cancelled.resolve(undefined); return drained.promise })
      bridge.handle(request(2, 'poll', { id }))
      await polling.promise
      bridge.handle({ type: 'native-authorization-cancel-request', requestId: 2 })
      await cancelled.promise
      pollResult.resolve(signedOut)
      expect(replies).toHaveLength(1)
      drained.resolve(signedOut)
      expect(await next()).toMatchObject({ requestId: 2, error: 'Native authorization unavailable' })
      expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
    })
  })

  it('drains a start that returns after shutdown begins', async () => {
    await fixture(async (bridge, provider, _replies, next) => {
      const starting = Promise.withResolvers<undefined>()
      const result = Promise.withResolvers<NativeAuthorizationAttempt>()
      const cancelled = Promise.withResolvers<undefined>()
      const drained = Promise.withResolvers<NativeAuthorizationState>()
      vi.mocked(provider.start).mockImplementation(async () => { starting.resolve(undefined); return result.promise })
      vi.mocked(provider.cancel).mockImplementation(async () => { cancelled.resolve(undefined); return drained.promise })
      bridge.handle(request(1, 'start', { choiceId: 'org' }))
      await starting.promise
      const disposed = vi.fn()
      const closing = bridge.dispose().then(disposed)
      result.resolve(attempt)
      await cancelled.promise
      expect(disposed).not.toHaveBeenCalled()
      drained.resolve(signedOut)
      const reply = next()
      await closing
      expect(await reply).toMatchObject({ requestId: 1, error: 'Native authorization unavailable' })
      expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
    })
  })

  it('coalesces explicit cancellation with concurrent shutdown', async () => {
    await fixture(async (bridge, provider, _replies, next) => {
      bridge.handle(request(1, 'start', { choiceId: 'org' }))
      await next()
      const cancelling = Promise.withResolvers<undefined>()
      const drained = Promise.withResolvers<NativeAuthorizationState>()
      provider.cancel.mockImplementation(async () => { cancelling.resolve(undefined); return drained.promise })
      bridge.handle(request(2, 'cancel', { id }))
      await cancelling.promise
      const closing = bridge.dispose()
      const reply = next()
      drained.resolve(signedOut)
      await closing
      expect(await reply).toMatchObject({ requestId: 2, error: 'Native authorization unavailable' })
      expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
    })
  })

  it('never sends issuer diagnostics, authorization codes or secrets in errors', async () => {
    await fixture(async (bridge, provider, replies, next) => {
      vi.mocked(provider.start).mockRejectedValue(new Error('secret token at https://login.example/callback?code=private'))
      bridge.handle(request(1, 'start', { choiceId: 'org' }))
      await next()
      expect(replies).toEqual([{ type: 'native-authorization', requestId: 1, error: 'Native authorization unavailable' }])
    })
  })

  it('does not cancel a successfully completed authorization during shutdown', async () => {
    await fixture(async (bridge, provider, _replies, next) => {
      bridge.handle(request(1, 'start', { choiceId: 'org' }))
      await next()
      bridge.handle(request(2, 'complete', { id, url: 'https://login.example/callback?code=private' }))
      await next()
      await bridge.dispose()
      expect(provider.cancel).not.toHaveBeenCalled()
    })
  })
})

it('ignores non-protocol values and malformed cancellation or request headers without allocating operations', async () => {
  await fixture(async (bridge, provider, replies) => {
    for (const value of [null, undefined, 7, 'native-authorization', {}, { unrelated: true }]) {
      expect(bridge.handle(value)).toBe(false)
    }
    for (const value of [
      { type: 'native-authorization-cancel-request' },
      { type: 'native-authorization-cancel-request', requestId: 'one' },
      { type: 'native-authorization-cancel-request', requestId: 999 },
      { type: 'native-authorization' },
      { type: 'native-authorization', requestId: 'one', action: 'state' },
      { type: 'native-authorization', requestId: 1.5, action: 'state' },
      { type: 'native-authorization', requestId: Number.MAX_SAFE_INTEGER + 1, action: 'state' },
      { type: 'native-authorization', requestId: 1 },
      { type: 'native-authorization', requestId: 1, action: false },
    ]) expect(bridge.handle(value)).toBe(true)
    await bridge.dispose()
    expect(provider.getState).not.toHaveBeenCalled()
    expect(provider.start).not.toHaveBeenCalled()
    expect(replies).toEqual([])
  })
})

it('rejects malformed action payloads with correlated safe errors before calling the provider', async () => {
  await fixture(async (bridge, provider, _replies, next) => {
    const malformed = [
      { action: 'start' },
      { action: 'start', choiceId: 12 },
      { action: 'start', choiceId: 'x'.repeat(257) },
      { action: 'complete' },
      { action: 'complete', id: 12 },
      { action: 'complete', id: 'x'.repeat(257) },
      { action: 'complete', id },
      { action: 'complete', id, url: 12 },
      { action: 'complete', id, url: 'x'.repeat(16385) },
      { action: 'unknown-operation', id },
    ]
    for (const [index, value] of malformed.entries()) {
      const response = next()
      bridge.handle({ type: 'native-authorization', requestId: index + 1, ...value })
      expect(await response).toEqual({ type: 'native-authorization', requestId: index + 1, error: 'Native authorization unavailable' })
    }
    expect(provider.start).not.toHaveBeenCalled()
    expect(provider.complete).not.toHaveBeenCalled()
    expect(provider.poll).not.toHaveBeenCalled()
    expect(provider.cancel).not.toHaveBeenCalled()
  })
})

it('defers unknown attempt authority to the provider and does not adopt or cancel it', async () => {
  await fixture(async (bridge, provider, _replies, next) => {
    const unknown = brandString<NativeAuthorizationAttemptId>('not-owned')
    provider.poll.mockRejectedValueOnce(new Error('Unknown attempt with private diagnostic'))
    bridge.handle(request(1, 'poll', { id: unknown }))
    expect(await next()).toEqual({ type: 'native-authorization', requestId: 1, error: 'Native authorization unavailable' })
    await bridge.dispose()
    expect(provider.cancel).not.toHaveBeenCalled()
  })
})

it('keeps a non-aborted failed attempt owned until explicit cancellation', async () => {
  await fixture(async (bridge, provider, _replies, next) => {
    bridge.handle(request(1, 'start', { choiceId: 'org' }))
    await next()
    provider.complete.mockRejectedValueOnce(new Error('Issuer unavailable with private callback code'))
    bridge.handle(request(2, 'complete', { id, url: 'https://login.example/callback?code=synthetic' }))
    expect(await next()).toEqual({ type: 'native-authorization', requestId: 2, error: 'Native authorization unavailable' })
    expect(provider.cancel).not.toHaveBeenCalled()
    bridge.handle(request(3, 'cancel', { id }))
    expect(await next()).toEqual({ type: 'native-authorization', requestId: 3, value: signedOut })
    await bridge.dispose()
    expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
  })
})

it('contains cancellation failure while withdrawing an owned aborted poll', async () => {
  await fixture(async (bridge, provider, _replies, next) => {
    bridge.handle(request(1, 'start', { choiceId: 'org' }))
    await next()
    const began = Promise.withResolvers<undefined>()
    const completed = Promise.withResolvers<NativeAuthorizationState>()
    provider.poll.mockImplementationOnce(async () => { began.resolve(undefined); return completed.promise })
    provider.cancel.mockRejectedValueOnce(new Error('Private cancellation diagnostic'))
    bridge.handle(request(2, 'poll', { id }))
    await began.promise
    bridge.handle({ type: 'native-authorization-cancel-request', requestId: 2 })
    completed.resolve(signedOut)
    expect(await next()).toEqual({ type: 'native-authorization', requestId: 2, error: 'Native authorization unavailable' })
    expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
  })
})

it('contains private IPC delivery rejection and remains quiescent on disposal', async () => {
  const ctx = new Context()
  const delivery = Promise.withResolvers<undefined>()
  const sent = vi.fn(async (_reply: object) => { delivery.resolve(undefined); throw new Error('Disconnected private IPC') })
  const bridge = nativeAuthorizationBridge(Promise.resolve(ctx), sent)
  bridge.handle(request(1, 'state'))
  await delivery.promise
  await bridge.dispose()
  expect(sent).toHaveBeenCalledTimes(2)
  expect(sent.mock.calls[1]![0]).toEqual({ type: 'native-authorization', requestId: 1, error: 'Native authorization unavailable' })
})

it('keeps a pending completion owned for shutdown cancellation', async () => {
  await fixture(async (bridge, provider, _replies, next) => {
    bridge.handle(request(1, 'start', { choiceId: 'org' }))
    await next()
    provider.complete.mockResolvedValueOnce({ status: 'pending', choices: [], attempt: { id, expiresAt: 100 } })
    bridge.handle(request(2, 'complete', { id, url: 'https://login.example/callback?code=synthetic' }))
    expect(await next()).toMatchObject({ requestId: 2, value: { status: 'pending' } })
    await bridge.dispose()
    expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(id)
  })
})
