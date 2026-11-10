/** Real RemoteStream supervision with synthetic external Remote and connection generations. */
import { expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { openUsage } from '../src/client/resource.ts'
import type { UsagePageData } from '../src/client/types.ts'
import { binding, hold, overview, remote, stream, usage } from './fixtures.client.ts'
const address = 'dsh-resource://uwork-usage/7d/requests/0'
async function firstResult(gateway: ReturnType<typeof remote>, path = address) {
  const controller = new AbortController()
  const values: RemoteResult<UsagePageData>[] = []
  for await (const value of openUsage(gateway, path, controller.signal)) {
    values.push(value)
    if (!value.ok || value.value.status !== 'loading') controller.abort()
  }
  return values
}

it('reads the exact selection and explicit refresh through the real stream supervisor', async () => {
  const gateway = remote()
  expect((await firstResult(gateway)).at(-1)).toEqual({ ok: true, value: { status: 'ready', overview, usage } })
  expect(gateway.uworkGateway.readUsage).toHaveBeenCalledWith({ period: '7d', metric: 'requests', force: false }, expect.any(AbortSignal))
  await firstResult(gateway, 'dsh-resource://uwork-usage/month/cost/1')
  expect(gateway.uworkGateway.readUsage).toHaveBeenLastCalledWith({ period: 'month', metric: 'cost', force: true }, expect.any(AbortSignal))
})
it.each(['unknown/requests/0', '7d/unknown/0', '7d/requests/invalid', '7d/requests'])('rejects an invalid address %s before transport', async (path) => {
  const gateway = remote()
  expect(await firstResult(gateway, `dsh-resource://uwork-usage/${path}`)).toMatchObject([{ ok: false, error: { code: 'uwork-gateway/invalid-query' } }])
  expect(gateway.uworkGateway.watchIdentity).not.toHaveBeenCalled()
})
it('clears terminal refusals and signed-out responses instead of retaining another account', async () => {
  const gateway = remote()
  const error = new RemoteError('uwork-gateway/cancelled', 'Synthetic refusal', {})
  vi.mocked(gateway.uworkGateway.getOverview).mockResolvedValueOnce({ ok: false, error })
  expect((await firstResult(gateway)).at(-1)).toEqual({ ok: true, value: { status: 'unavailable' } })
  vi.mocked(gateway.uworkGateway.readUsage).mockResolvedValueOnce({ ok: false, error })
  expect((await firstResult(gateway)).at(-1)).toEqual({ ok: true, value: { status: 'unavailable' } })
  vi.mocked(gateway.uworkGateway.readUsage).mockResolvedValueOnce({ ok: true, value: { status: 'signed-out' } })
  expect((await firstResult(gateway)).at(-1)).toEqual({ ok: true, value: { status: 'signed-out' } })
  vi.mocked(gateway.uworkGateway.getOverview).mockResolvedValueOnce({ ok: true, value: { status: 'signed-out' } })
  expect((await firstResult(gateway)).at(-1)).toEqual({ ok: true, value: { status: 'signed-out' } })
  vi.mocked(gateway.uworkGateway.watchIdentity).mockReturnValueOnce(stream({ async *[Symbol.asyncIterator]() { yield null } }))
  expect((await firstResult(gateway)).at(-1)).toEqual({ ok: true, value: { status: 'signed-out' } })
})
it('withdraws authenticated values on carrier loss and automatically recovers on another Host generation', async () => {
  const gateway = remote()
  const dropped = Promise.withResolvers<undefined>()
  vi.mocked(gateway.uworkGateway.watchIdentity)
    .mockImplementationOnce(() => stream({ async *[Symbol.asyncIterator]() {
      yield binding
      await dropped.promise
      throw new RemoteStreamCarrierError('synthetic carrier loss')
    } }))
    .mockImplementationOnce(signal => stream({ async *[Symbol.asyncIterator]() {
      yield null
      await hold(signal ?? new AbortController().signal)
    } }))
  const controller = new AbortController()
  const values: RemoteResult<UsagePageData>[] = []
  const work = (async () => { for await (const value of openUsage(gateway, address, controller.signal)) values.push(value) })()
  await vi.waitFor(() =>{  expect(values.at(-1)).toMatchObject({ ok: true, value: { status: 'ready' } }) })
  gateway.generation.set(undefined)
  dropped.resolve(undefined)
  await vi.waitFor(() =>{  expect(values.at(-1)).toEqual({ ok: true, value: { status: 'unavailable' } }) })
  gateway.generation.set({ id: 2, host: { home: '/synthetic-other-host' } })
  await vi.waitFor(() =>{  expect(values.at(-1)).toEqual({ ok: true, value: { status: 'signed-out' } }) })
  controller.abort()
  await work
  expect(gateway.uworkGateway.watchIdentity).toHaveBeenCalledTimes(2)
})
it('keeps same-identity retained failures, but never combines differently owned overview and usage', async () => {
  const gateway = remote()
  if (overview.status !== 'ready' || usage.status !== 'ready') throw new Error('Synthetic ready fixture required')
  vi.mocked(gateway.uworkGateway.getOverview).mockResolvedValueOnce({ ok: true, value: { status: 'error', reason: 'network', lastSuccess: overview } })
  vi.mocked(gateway.uworkGateway.readUsage).mockResolvedValueOnce({ ok: true, value: { status: 'error', reason: 'network' } })
  expect((await firstResult(gateway)).at(-1)).toMatchObject({ ok: true, value: { status: 'ready', overview: { status: 'error' }, usage: { status: 'error' } } })
  const controller = new AbortController()
  vi.mocked(gateway.uworkGateway.getOverview).mockResolvedValueOnce({ ok: true, value: { ...overview, binding: { ...binding, userId: 'synthetic-other-user' } } })
  const values: RemoteResult<UsagePageData>[] = []
  const work = (async () => { for await (const value of openUsage(gateway, address, controller.signal)) values.push(value) })()
  await vi.waitFor(() =>{  expect(gateway.uworkGateway.getOverview).toHaveBeenCalledTimes(2) })
  controller.abort()
  await work
  expect(values.every(value => value.ok && value.value.status === 'loading')).toBe(true)
})
it('contains terminal stream errors and ignores already cancelled holders', async () => {
  const gateway = remote()
  vi.mocked(gateway.uworkGateway.watchIdentity).mockImplementationOnce(() => { throw new Error('synthetic-private-diagnostic') })
  const failure = await firstResult(gateway)
  expect(failure.at(-1)).toEqual({ ok: true, value: { status: 'unavailable' } })
  expect(JSON.stringify(failure)).not.toContain('synthetic-private-diagnostic')
  const controller = new AbortController()
  controller.abort()
  const values = []
  for await (const value of openUsage(gateway, address, controller.signal)) values.push(value)
  expect(values).toEqual([])
})

it('ends cleanly after a terminal stream end and discards a read aborted during aggregation', async () => {
  const gateway = remote()
  vi.mocked(gateway.uworkGateway.watchIdentity).mockReturnValueOnce(stream({ async *[Symbol.asyncIterator]() { yield null } }))
  const complete = []
  for await (const value of openUsage(gateway, address, new AbortController().signal)) complete.push(value)
  expect(complete.at(-1)).toEqual({ ok: true, value: { status: 'unavailable' } })
  const controller = new AbortController()
  vi.mocked(gateway.uworkGateway.readUsage).mockImplementationOnce(async () => { controller.abort(); return { ok: true, value: usage } })
  const cancelled = []
  for await (const value of openUsage(gateway, address, controller.signal)) cancelled.push(value)
  expect(cancelled.every(value => value.ok && value.value.status === 'loading')).toBe(true)
})

it.each(['overview', 'usage'] as const)('withdraws both sections when %s cannot verify identity', async (section) => {
  const gateway = remote()
  if (section === 'overview') vi.mocked(gateway.uworkGateway.getOverview).mockResolvedValueOnce({ ok: true, value: { status: 'error', reason: 'identity' } })
  else vi.mocked(gateway.uworkGateway.readUsage).mockResolvedValueOnce({ ok: true, value: { status: 'error', reason: 'identity' } })
  expect((await firstResult(gateway)).at(-1)).toEqual({ ok: true, value: { status: 'unavailable' } })
})
