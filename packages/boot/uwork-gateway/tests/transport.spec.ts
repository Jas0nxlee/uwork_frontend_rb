/** TLS compatibility applies only to configured enterprise origins and releases its owned dispatcher. */
import { Context } from '@deepseek-ai/cordis'
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { afterEach, expect, it, vi } from 'vitest'
import { createRouteDispatcher } from '@deepseek-ai/dsh-http-proxy'
import { apply, Config } from '../src/transport-plugin.ts'

vi.mock('@deepseek-ai/dsh-http-proxy', () => ({ createRouteDispatcher: vi.fn() }))

class TestDispatcher extends Dispatcher {
  readonly dispatches: string[] = []
  readonly closed = vi.fn()
  override dispatch(options: Dispatcher.DispatchOptions): boolean {
    this.dispatches.push(String(options.origin))
    return true
  }
  override async close(): Promise<void> { this.closed() }
}

const original = getGlobalDispatcher()
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  setGlobalDispatcher(original)
  vi.restoreAllMocks()
})

it('routes the enterprise origin and restores the previous dispatcher on unload', async () => {
  const fallback = new TestDispatcher()
  const transport = new TestDispatcher()
  setGlobalDispatcher(fallback)
  vi.mocked(createRouteDispatcher).mockResolvedValue(transport)
  const ctx = new Context()
  contexts.push(ctx)
  const plugin = ctx.plugin({ apply, Config }, { origins: ['https://issuer.example'], ecdhCurve: 'X25519:prime256v1' })
  await plugin.await()
  const dispatcher = getGlobalDispatcher()
  dispatcher.dispatch({ origin: 'https://issuer.example', path: '/', method: 'GET' }, {})
  dispatcher.dispatch({ origin: 'https://other.example', path: '/', method: 'GET' }, {})
  expect(transport.dispatches).toEqual(['https://issuer.example'])
  expect(fallback.dispatches).toEqual(['https://other.example'])
  await plugin.dispose()
  expect(getGlobalDispatcher()).toBe(fallback)
  expect(transport.closed).toHaveBeenCalledOnce()
  expect(fallback.closed).not.toHaveBeenCalled()
})
