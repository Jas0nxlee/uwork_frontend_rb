import { describe, expect, it, vi } from 'vitest'
import { GatewayClient, GatewayRequestError } from '../src/index.ts'
import type { GatewayConfig } from '../src/types.ts'

// Every authenticated response in this file is synthetic; no employee data or real token is recorded.
const config: GatewayConfig = { apiBaseUrl: 'https://gateway.example.com:23090', allowedModelEndpointOrigins: ['https://models.example.com'], timeoutMs: 1000, maxResponseBytes: 10000, maxItems: 3 }
function setup(value: unknown, status = 200, override: Partial<GatewayConfig> = {}) {
  const controller = new AbortController()
  const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(value), { status }))
  const client = new GatewayClient({ ...config, ...override }, { orgId: 'synthetic-org', userId: 'synthetic-user', generation: 'synthetic-generation', token: 'synthetic-token', signal: controller.signal }, request)
  return { client, request, controller }
}
const usage = { period: '7d', metric: 'requests', from: '2026-11-01', until: '2026-11-07', summary: { requestCount: 10, successCount: 9, successRate: 90, cost: 2, averageCost: .2, promptTokens: 15, completionTokens: 5, totalTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 }, trend: [], models: [] }

describe('Host gateway protocol', () => {
  it('uses exact control origin, disallows redirects and encodes requested aggregation', async () => {
    const { client, request } = setup(usage)
    expect(await client.readUsage({ period: '7d', metric: 'requests', force: true })).toMatchObject({ costUnit: 'unspecified', summary: { successRate: .9, cost: 2 } })
    const [url, init] = request.mock.calls[0]!
    expect(url instanceof URL ? url.href : url).toBe('https://gateway.example.com:23090/api/usage/stats?period=7d&metric=requests&refresh=1')
    expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer synthetic-token' } })
  })
  it.each([[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate-limited'], [500, 'http']] as const)('classifies %i without response disclosure', async (status, kind) => {
    await expect(setup({ secret: 'synthetic-private-response' }, status).client.listKeys()).rejects.toMatchObject({ kind, status })
  })
  it('never replaces failed or mismatched statistics with zero', async () => {
    await expect(setup({ ...usage, period: 'month' }).client.readUsage({ period: '7d', metric: 'requests' })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(setup({ ...usage, summary: {} }).client.readUsage({ period: '7d', metric: 'requests' })).rejects.toMatchObject({ kind: 'invalid' })
  })
  it('bounds response bytes and collection items', async () => {
    await expect(setup({ keys: [] }, 200, { maxResponseBytes: 2 }).client.listKeys()).rejects.toMatchObject({ kind: 'invalid' })
    await expect(setup({ keys: Array.from({ length: 4 }, () => ({ id: 1, masked_key: 'synthetic-masked', status: 'active' })) }).client.listKeys()).rejects.toMatchObject({ kind: 'invalid' })
  })
  it('returns only public HTTPS endpoint and drops internal plaintext URL', async () => {
    expect(await setup({ llm_base_url: 'https://models.example.com/v1/', llm_base_url_internal: 'http://10.0.0.1/v1' }).client.readPublicEndpoint()).toBe('https://models.example.com/v1')
    await expect(setup({ llm_base_url: 'http://10.0.0.1' }).client.readPublicEndpoint()).rejects.toMatchObject({ kind: 'invalid' })
    await expect(setup({ llm_base_url: 'https://unadmitted.example.com' }).client.readPublicEndpoint()).rejects.toMatchObject({ kind: 'invalid' })
  })
  it('uses the OpenAI v1 API for an advertised bare origin and preserves an explicit prefix', async () => {
    const { client, request } = setup({ llm_base_url: 'https://models.example.com' })
    const endpoint = await client.readPublicEndpoint()
    expect(endpoint).toBe('https://models.example.com/v1')
    request.mockResolvedValueOnce(Response.json({ data: [{ id: 'synthetic-model' }] }))
    expect(await client.listEndpointModels(endpoint, 'synthetic-key')).toEqual([{ id: 'synthetic-model' }])
    expect(request).toHaveBeenLastCalledWith(new URL('https://models.example.com/v1/models'),
      expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer synthetic-key' }, redirect: 'error' }))
    expect(await setup({ llm_base_url: 'https://models.example.com/tenant/v1/' }).client.readPublicEndpoint())
      .toBe('https://models.example.com/tenant/v1')
  })
  it.each(['http://gateway.example.com', 'https://127.0.0.1', 'https://gateway.internal', 'https://name:secret@gateway.example.com', 'https://gateway.example.com/path'])('rejects unsafe control address %s', (apiBaseUrl) => {
    expect(() => setup({}, 200, { apiBaseUrl })).toThrow()
  })
  it('keeps unknown key generation outcomes without retrying', async () => {
    const { client, request } = setup({}, 200)
    await expect(client.generateKey('synthetic-intent')).rejects.toMatchObject({ kind: 'invalid', mutationOutcome: 'unknown' })
    expect(request).toHaveBeenCalledTimes(1)
    await expect(setup({}, 500).client.generateKey('synthetic-intent')).rejects.toMatchObject({ mutationOutcome: 'unknown' })
    await expect(setup({}, 408).client.generateKey('synthetic-intent')).rejects.toMatchObject({ mutationOutcome: 'unknown' })
    await expect(setup({}, 403).client.generateKey('synthetic-intent')).rejects.toMatchObject({ mutationOutcome: 'unchanged' })
  })
  it('cancels before request when identity epoch has ended', async () => {
    const { client, request, controller } = setup({ keys: [] })
    controller.abort()
    await expect(client.listKeys()).rejects.toMatchObject({ kind: 'cancelled' })
    expect(request).not.toHaveBeenCalled()
  })
  it('maps masked keys, subscriptions and plan models without inventing monetary units', async () => {
    expect(await setup({ keys: [{ id: 1, alias: null, masked_key: 'synthetic-masked', status: 'active' }] }).client.listKeys()).toEqual([{ id: '1', alias: null, maskedKey: 'synthetic-masked', status: 'active' }])
    expect(await setup({ subscriptions: [{ plan_id: 1, plan_title: 'Synthetic plan', amount_total: 3, amount_used: 2, status: 'active' }] }).client.readSubscriptions()).toMatchObject([{ amountUnit: 'unspecified', nextResetTime: null }])
    expect(await setup({ models: ['synthetic-model', 'synthetic-model'], unrestricted: false, hasSubscription: true }).client.readPlanModels()).toEqual({ models: ['synthetic-model'], unrestricted: false, hasSubscription: true })
  })
  it('classifies network failure without retaining the raw cause', async () => {
    const { client, request } = setup({})
    request.mockRejectedValue(new Error('synthetic secret cause'))
    await expect(client.listKeys()).rejects.toEqual(new GatewayRequestError('network'))
    await expect(client.generateKey('synthetic-intent')).rejects.toMatchObject({ kind: 'network', mutationOutcome: 'unknown' })
  })
  it('bounds a stalled response body with timeout and identity cancellation', async () => {
    const timed = setup({}, 200, { timeoutMs: 10 })
    timed.request.mockImplementation(async () => new Response(new ReadableStream()))
    await expect(timed.client.listKeys()).rejects.toMatchObject({ kind: 'timeout' })
    const cancelled = setup({})
    cancelled.request.mockImplementation(async () => new Response(new ReadableStream({
      start() { queueMicrotask(() =>{  cancelled.controller.abort() }) },
    })))
    await expect(cancelled.client.listKeys()).rejects.toMatchObject({ kind: 'cancelled' })
  })
  it('keeps malformed JSON, invalid UTF-8 and absent bodies as invalid responses', async () => {
    const { client, request } = setup({})
    for (const body of ['{', new Uint8Array([255]), null]) {
      request.mockImplementation(async () => new Response(body))
      await expect(client.listKeys()).rejects.toMatchObject({ kind: 'invalid' })
    }
  })
  it('reveals and generates secrets only through Host client methods', async () => {
    const { client, request } = setup({ id: 'synthetic-key', key: 'synthetic-secret', masked_key: 'synthetic-mask' })
    const created = await client.generateKey('synthetic-intent')
    expect(created).toEqual({ apiKey: 'synthetic-secret', key: { id: 'synthetic-key', alias: 'synthetic-intent', maskedKey: 'synthetic-mask', status: 'active' } })
    expect(await setup({ key: 'synthetic-secret' }).client.revealKey(created.key.id)).toBe('synthetic-secret')
    await expect(client.generateKey('')).rejects.toThrow('Key alias is required')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid deployment limits at construction', () => {
    expect(() => setup({}, 200, { maxItems: 0 })).toThrow('Invalid gateway limit')
    expect(() => setup({}, 200, { allowedModelEndpointOrigins: [] })).toThrow('Model endpoint allowlist must not be empty')
    expect(() => setup({}, 200, { allowedModelEndpointOrigins: ['https://models.example.com/v1'] })).toThrow('Model allowlist entries must be origins')
  })
  it('classifies fetch rejection after caller or deadline cancellation', async () => {
    const cancelled = setup({})
    cancelled.request.mockImplementation(async () => { cancelled.controller.abort(); throw new Error('synthetic abort') })
    await expect(cancelled.client.listKeys()).rejects.toMatchObject({ kind: 'cancelled' })
    const timed = setup({}, 200, { timeoutMs: 10 })
    timed.request.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () =>{  reject(new Error('synthetic deadline')) }, { once: true })
    }))
    await expect(timed.client.listKeys()).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('contains body cancellation errors without exposing their cause', async () => {
    const { client, request } = setup({}, 200, { timeoutMs: 10 })
    request.mockImplementation(async () => new Response(new ReadableStream({ cancel() { throw new Error('synthetic transport cancellation') } })))
    await expect(client.listKeys()).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('discovers explicit endpoint capabilities using the model key on the admitted endpoint', async () => {
    const { client, request } = setup({ llm_base_url: 'https://models.example.com/prefix/v1' })
    const endpoint = await client.readPublicEndpoint()
    request.mockResolvedValue(new Response(JSON.stringify({ data: [
      'synthetic-unknown',
      { id: 'synthetic-capable', context_window: 100, context_length: 100, max_output_tokens: 20, input_modalities: ['text', 'image'], supports_vision: true, supports_tools: true, supports_reasoning: true, reasoning_levels: ['high', 'low'], map: 'never-execute-remote-code' },
      { id: 'synthetic-alternate', context_length: 50, architecture: { input_modalities: ['text'] }, supports_vision: false, supports_tools: false, supports_reasoning: false },
      { id: 'synthetic-effort', reasoning_effort: ['medium'] },
      { id: 'synthetic-supported', supported_reasoning_efforts: ['none'] },
    ] })))
    // This fixture explicitly increases the deployment's collection budget.
    const limited = setup({}, 200, { maxItems: 5 })
    limited.request.mockResolvedValueOnce(new Response(JSON.stringify({ llm_base_url: endpoint })))
    await limited.client.readPublicEndpoint()
    limited.request.mockImplementation(request)
    const models = await limited.client.listEndpointModels(endpoint, 'synthetic-model-api-key')
    expect(models).toEqual([
      { id: 'synthetic-unknown' },
      { id: 'synthetic-capable', contextWindow: 100, maxOutputTokens: 20, inputModalities: ['text', 'image'], supportsVision: true, supportsTools: true, supportsReasoning: true, reasoningLevels: ['low', 'high'] },
      { id: 'synthetic-alternate', contextWindow: 50, inputModalities: ['text'], supportsVision: false, supportsTools: false, supportsReasoning: false },
      { id: 'synthetic-effort', reasoningLevels: ['medium'] },
      { id: 'synthetic-supported', reasoningLevels: ['none'] },
    ])
    const [url, init] = limited.request.mock.calls.at(-1)!
    expect(url).toBeInstanceOf(URL)
    expect(url instanceof URL && url.href).toBe('https://models.example.com/prefix/v1/models')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-model-api-key' })
  })
  it.each([
    { id: 'bad', context_window: -1 }, { id: 'bad', supports_tools: 'yes' },
    { id: 'bad', input_modalities: ['text', 'text'] }, { id: 'bad', reasoning_levels: ['unsupported'] },
    { id: 'bad', reasoning_levels: ['low', 'low'] }, { id: 'bad', context_window: 100, context_length: 200 },
    { id: 'bad', input_modalities: ['text'], supports_vision: true },
    { id: 'bad', reasoning_levels: ['high'], supports_reasoning: false }, { id: 'bad\ncontrol' },
  ])('rejects malformed capability facts as one directory failure: %j', async (value) => {
    const { client, request } = setup({ llm_base_url: 'https://models.example.com/v1' })
    const endpoint = await client.readPublicEndpoint()
    request.mockResolvedValue(new Response(JSON.stringify({ data: [value] })))
    await expect(client.listEndpointModels(endpoint, 'synthetic-model-api-key')).rejects.toMatchObject({ kind: 'invalid' })
  })
  it('does not disclose either bearer to an unadmitted model endpoint', async () => {
    const { client, request } = setup({ llm_base_url: 'https://models.example.com/v1' })
    await expect(client.listEndpointModels('https://models.example.com/v1', 'synthetic-key')).rejects.toMatchObject({ kind: 'invalid' })
    const endpoint = await client.readPublicEndpoint()
    await expect(client.listEndpointModels(endpoint, '')).rejects.toMatchObject({ kind: 'invalid' })
    expect(request).toHaveBeenCalledTimes(1)
    request.mockResolvedValue(new Response(JSON.stringify({ data: ['synthetic-duplicate', 'synthetic-duplicate'] })))
    await expect(client.listEndpointModels(endpoint, 'synthetic-key')).rejects.toMatchObject({ kind: 'invalid' })
  })
  it('keeps status classifications when an error response body fails cancellation', async () => {
    const { client, request } = setup({})
    request.mockImplementationOnce(async () => new Response(new ReadableStream({
      cancel() { throw new Error('synthetic-private-body-failure') },
    }), { status: 401 }))
    await expect(client.listKeys()).rejects.toMatchObject({ kind: 'unauthorized', status: 401 })
    request.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(client.listKeys()).rejects.toMatchObject({ kind: 'forbidden', status: 403 })
  })
})
