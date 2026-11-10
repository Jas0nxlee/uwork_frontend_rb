/** Explicitly synthetic safe aggregate projections and external Remote doubles. */
import { vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OrganizationId, IdentityGeneration } from '@deepseek-ai/dsh-uwork-enterprise/types'
import { RemoteStream } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { UsageRemote } from '../src/client/resource.ts'
import type { TypertClientRemote, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type { GatewayBinding, OverviewState, UsageState } from '@deepseek-ai/dsh-uwork-gateway-service/types'

export const binding: GatewayBinding = { orgId: brandString<OrganizationId>('synthetic-org'), userId: 'synthetic-user', generation: brandString<IdentityGeneration>('synthetic-generation') }
export const usage: UsageState = { status: 'ready', binding, updatedAt: 1793707200000, data: {
  period: '7d', metric: 'requests', from: '2026-11-01', until: '2026-11-07', costUnit: 'unspecified',
  summary: {
    requestCount: 10, successCount: 9, successRate: .9, cost: 2.5, averageCost: .25, promptTokens: 100, completionTokens: 20,
    totalTokens: 120, cacheReadTokens: 0, cacheCreationTokens: 0 },
  trend: [{ date: '2026-11-01', requestCount: 10, cost: 2.5, tokens: 120 }],
  models: [{ model: 'synthetic-model', requestCount: 10, cost: 2.5, share: 100 }],
} }
export const overview: OverviewState = { status: 'ready', binding, updatedAt: 1793707200000, data: {
  publicEndpoint: 'https://models.example.com/v1', keys: [], planModels: { models: ['synthetic-model'], unrestricted: false, hasSubscription: true },
  subscriptions: [{ planId: 'synthetic-plan', planTitle: 'Synthetic subscription', amountTotal: 100, amountUsed: 25, amountUnit: 'unspecified', nextResetTime: null, status: 'active' }],
} }
export function stream(values: AsyncIterable<GatewayBinding | null>): RemoteStreamHandle<GatewayBinding | null, never> {
  return { [Symbol.asyncIterator]: () => values[Symbol.asyncIterator](), send: vi.fn(), end: vi.fn(), dispose: vi.fn() }
}
export function hold(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}
export function remote(): UsageRemote & { generation: ReturnType<typeof createSnapshotStore<ConnectionGeneration | undefined>> } {
  const generation = createSnapshotStore<ConnectionGeneration | undefined>({ id: 1, host: { home: '/synthetic-host' } })
  const gateway: TypertClientRemote['uworkGateway'] = {
    getOverview: vi.fn(async () => ({ ok: true as const, value: overview })),
    refreshModels: vi.fn(async () => ({ ok: true as const, value: overview })),
    readUsage: vi.fn(async () => ({ ok: true as const, value: usage })),
    watchIdentity: vi.fn<TypertClientRemote['uworkGateway']['watchIdentity']>(signal => stream({
      async *[Symbol.asyncIterator]() { yield binding; await hold(signal ?? new AbortController().signal) },
    })),
  }
  return { uworkGateway: gateway, generation, $stream: options => new RemoteStream({ generation }, options) }
}
