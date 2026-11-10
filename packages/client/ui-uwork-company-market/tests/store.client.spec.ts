/** Company catalog queries own cancellation, retained results and late completion. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertClientRemote, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CompanyMarketPage } from '@deepseek-ai/dsh-uwork-company-market/types'
import { MarketController } from '../src/client/store.ts'

const page: CompanyMarketPage = { source: 'https://market.example', items: [], total: 0, page: 0, nextPage: null }
const ok = (value = page): RemoteResult<CompanyMarketPage> => ({ ok: true, value })

function setup() {
  const search = vi.fn<TypertClientRemote['uworkCompanyMarket']['search']>(async () => ok())
  const controller = new MarketController({ search })
  onTestFinished(() => { controller.dispose() })
  return { search, controller, face: controller.face, snapshot: () => controller.store.getSnapshot() }
}

it('loads on first mount, retains the query across mounts and refreshes explicitly', async () => {
  const h = setup()
  expect(h.snapshot().status).toBe('idle')
  h.face.start()
  h.face.start()
  await vi.waitFor(() => { expect(h.snapshot().status).toBe('ready') })
  expect(h.search).toHaveBeenCalledTimes(1)
  h.face.load('weather', 2)
  expect(h.snapshot()).toMatchObject({ status: 'loading', text: 'weather', page: 2, value: page })
  await vi.waitFor(() => { expect(h.snapshot().status).toBe('ready') })
  h.face.start()
  expect(h.search).toHaveBeenCalledTimes(2)
})

it('aborts an old query, suppresses late completion and releases the invocation on dispose', async () => {
  const h = setup()
  const old = Promise.withResolvers<RemoteResult<CompanyMarketPage>>()
  h.search.mockImplementationOnce(() => old.promise)
  h.face.start()
  const oldSignal = h.search.mock.calls[0]![2]!
  h.face.load('new', 0)
  expect(oldSignal.aborted).toBe(true)
  await vi.waitFor(() => { expect(h.snapshot()).toMatchObject({ status: 'ready', text: 'new' }) })
  old.resolve(ok({ ...page, total: 999 }))
  await old.promise
  expect(h.snapshot()).toMatchObject({ text: 'new', value: { total: 0 } })
  h.controller.dispose()
  expect(h.search.mock.calls[1]![2]!.aborted).toBe(true)
  h.face.load('after disposal', 0)
  expect(h.search).toHaveBeenCalledTimes(2)
})

it.each([
  ['network', 'network'], ['http', 'network'], ['invalid', 'invalid'], ['limit', 'limit'],
  ['unauthorized', 'auth'], ['forbidden', 'auth'], ['rate-limited', 'rate'],
] as const)('keeps prior results and categorizes %s failures as %s', async (reason, failure) => {
  const h = setup()
  h.face.start()
  await vi.waitFor(() => { expect(h.snapshot().status).toBe('ready') })
  h.search.mockResolvedValueOnce({ ok: false, error: new RemoteError('uwork-company-market/unavailable', 'failed', { reason }) })
  h.face.load('', 0)
  await vi.waitFor(() => { expect(h.snapshot()).toMatchObject({ status: 'error', failure, value: page }) })
})

it('reports query and carrier failures, including rejected calls, without discarding results', async () => {
  const h = setup()
  h.search.mockResolvedValueOnce({ ok: false, error: new RemoteError('uwork-company-market/invalid-query', 'bad page', {}) })
  h.face.load('', 999)
  await vi.waitFor(() => { expect(h.snapshot()).toMatchObject({ status: 'error', failure: 'query', value: null }) })
  h.search.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/cancelled', 'cancelled', {}) })
  h.face.load('', 0)
  await vi.waitFor(() => { expect(h.snapshot()).toMatchObject({ status: 'error', failure: 'network' }) })
  h.search.mockRejectedValueOnce(new Error('disconnected'))
  h.face.load('', 0)
  await vi.waitFor(() => { expect(h.snapshot()).toMatchObject({ status: 'error', failure: 'network' }) })
})

it('ignores a rejected old request and a request that finishes after disposal', async () => {
  const h = setup()
  const old = Promise.withResolvers<RemoteResult<CompanyMarketPage>>()
  const current = Promise.withResolvers<RemoteResult<CompanyMarketPage>>()
  h.search.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
  h.face.load('old', 0)
  h.face.load('new', 0)
  old.reject(new Error('late failure'))
  await Promise.resolve()
  expect(h.snapshot()).toMatchObject({ text: 'new', status: 'loading' })
  h.controller.dispose()
  current.resolve(ok())
  await current.promise
  expect(h.snapshot()).toMatchObject({ text: 'new', status: 'loading' })
})
