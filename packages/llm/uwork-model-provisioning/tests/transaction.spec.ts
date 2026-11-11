import { describe, expect, it } from 'vitest'
import { ManagedRouteTransaction, type Journal, type ProvisionInput, type RouteDocument, type TransactionPorts } from '../src/transaction.ts'

function fixture() {
  let journal: Journal | undefined
  let doc: RouteDocument = { revision: 0, providers: { personal: { apiKeyEnv: 'PERSONAL_KEY' } } }
  let selection = { provider: 'personal', model: 'mine' }
  const secrets = new Map<string, string>()
  const ports: TransactionPorts = {
    readJournal: async () => journal,
    writeJournal: async (next) => { journal = next },
    hasSecret: async ref => secrets.has(ref),
    setSecret: async (ref, key) => { secrets.set(ref, key) },
    deleteSecret: async (ref) => { secrets.delete(ref) },
    readRoutes: () => structuredClone(doc),
    writeRoutes: async (providers, revision) => { if (revision !== doc.revision) throw new Error('conflict'); doc = { providers, revision: revision + 1 } },
    currentDefault: () => selection,
    saveDefault: async (next) => { selection = next },
  }
  const controller = new AbortController()
  const input: ProvisionInput = { binding: { orgId: 'org', userId: 'user', generation: 'gen' },
    provider: 'uwork-gen', credentialRef: 'UWORK_GEN', endpoint: 'https://gateway.example/v1', apiKey: 'secret',
    authorizedModels: ['allowed'], capabilities: [{ id: 'allowed', contextWindow: 8192, maxTokens: 1024, input: ['text'] },
      { id: 'not-authorized', contextWindow: 8192, maxTokens: 1024, input: ['image'] }],
    preferredModels: ['not-authorized', 'allowed'], signal: controller.signal }
  return { ports, input, controller, secrets, get journal() { return journal }, get doc() { return doc },
    get selection() { return selection }, setDefault: (value: typeof selection) => { selection = value },
    engine: new ManagedRouteTransaction(ports) }
}
describe('managed route transaction', () => {
  it('commits only authorized explicit models and keeps personal settings and default', async () => {
    const f = fixture(); const route = await f.engine.provision(f.input)
    expect(route.profile.displayName).toBe('UWork')
    expect(route.profile.models?.map(model => model.id)).toEqual(['allowed'])
    expect(f.doc.providers.personal).toEqual({ apiKeyEnv: 'PERSONAL_KEY' })
    expect(JSON.stringify(f.doc)).not.toContain('secret')
    expect(f.secrets.get('UWORK_GEN')).toBe('secret')
    expect(f.journal?.phase).toBe('committed')
    expect(f.selection).toEqual({ provider: 'personal', model: 'mine' })
    expect(f.engine.requestSignal('personal', 'mine', '', undefined)).toBeUndefined()
    expect(f.engine.requestSignal('uwork-gen', 'allowed', f.input.endpoint, f.journal?.route.profile)?.aborted).toBe(false)
    expect(() => f.engine.requestSignal('uwork-gen', 'not-authorized', f.input.endpoint, f.journal?.route.profile)).toThrow(/authorization expired/)
  })
  it('aborts in-flight old requests immediately on logout', async () => {
    const f = fixture(); await f.engine.provision(f.input)
    const signal = f.engine.requestSignal('uwork-gen', 'allowed', f.input.endpoint, f.journal?.route.profile)!
    f.controller.abort()
    expect(signal.aborted).toBe(true)
    expect(() => f.engine.requestSignal('uwork-gen', 'allowed', f.input.endpoint, f.journal?.route.profile)).toThrow(/authorization expired/)
  })
  it('reconciles committed settings on restart without accepting old calls', async () => {
    const f = fixture(); await f.engine.provision(f.input)
    const restarted = new ManagedRouteTransaction(f.ports)
    expect(() => restarted.requestSignal('uwork-gen', 'allowed', f.input.endpoint, f.journal?.route.profile)).toThrow()
    await restarted.recover()
    expect(f.journal).toBeUndefined(); expect(f.secrets.size).toBe(0)
    expect(Object.keys(f.doc.providers)).toEqual(['personal'])
    await restarted.recover()
  })
  it('compensates a settings conflict without overwriting a concurrent personal edit', async () => {
    const f = fixture()
    f.ports.writeRoutes = async () => { throw new Error('revision conflict') }
    await expect(f.engine.provision(f.input)).rejects.toThrow('revision conflict')
    expect(f.secrets.size).toBe(0); expect(f.journal).toBeUndefined()
    expect(Object.keys(f.doc.providers)).toEqual(['personal'])
  })
  it('leaves a durable recovery marker if compensation fails', async () => {
    const f = fixture()
    f.ports.writeRoutes = async () => { throw new Error('conflict') }
    f.ports.deleteSecret = async () => { throw new Error('unavailable') }
    await expect(f.engine.provision(f.input)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
    expect(f.journal?.phase).toBe('staged')
    await expect(f.engine.provision(f.input)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
  })
  it('rejects expired sessions before staging secrets', async () => {
    const f = fixture(); f.controller.abort()
    await expect(f.engine.provision(f.input)).rejects.toMatchObject({ code: 'REVOKED' })
    expect(f.journal).toBeUndefined()
  })
  it('does not erase a concurrently replaced managed route during recovery', async () => {
    const f = fixture(); await f.engine.provision(f.input)
    await f.ports.writeRoutes({ ...f.doc.providers, 'uwork-gen': { displayName: 'user change' } }, f.doc.revision)
    await f.engine.recover()
    expect(f.doc.providers['uwork-gen']).toEqual({ displayName: 'user change' })
  })
  it('chooses only the preferred authorized model when there is no personal default', async () => {
    const f = fixture(); f.setDefault({ provider: '', model: '' })
    await f.engine.provision(f.input)
    expect(f.selection).toEqual({ provider: 'uwork-gen', model: 'allowed' })
  })
  it('preserves already configured credential material without staging or deleting it', async () => {
    const f = fixture(); f.secrets.set('UWORK_GEN', 'preexisting-personal-secret')
    await expect(f.engine.provision(f.input)).rejects.toMatchObject({ code: 'ROUTE_CONFLICT' })
    expect(f.secrets.get('UWORK_GEN')).toBe('preexisting-personal-secret'); expect(f.journal).toBeUndefined()
  })
  it.each(['route', 'reference'])('does not overwrite an existing %s', async (collision) => {
    const f = fixture()
    await f.ports.writeRoutes({ ...f.doc.providers, [collision === 'route' ? 'uwork-gen' : 'other']: { apiKeyEnv: 'UWORK_GEN' } }, f.doc.revision)
    await expect(f.engine.provision(f.input)).rejects.toMatchObject({ code: 'ROUTE_CONFLICT' })
    expect(f.journal).toBeUndefined()
  })
  it('seals a queued operation when a newer operation supersedes it', async () => {
    const f = fixture()
    const first = f.engine.provision(f.input); const second = f.engine.provision(f.input)
    await expect(first).rejects.toMatchObject({ code: 'REVOKED' }); await second
  })
  it('retains the same-account route and chosen default after recovery without reusing a revoked credential', async () => {
    const f = fixture()
    const input = { ...f.input, authorizedModels: ['allowed', 'alternate'], capabilities: [...f.input.capabilities,
      { id: 'alternate', contextWindow: 8192, maxTokens: 1024, input: ['text' as const] }] }
    await f.engine.provision(input)
    f.setDefault({ provider: 'uwork-gen', model: 'alternate' })
    await f.engine.recover()
    const refreshed = await f.engine.provision({ ...input, provider: 'uwork-second', credentialRef: 'UWORK_SECOND' })
    expect(refreshed.provider).toBe('uwork-gen')
    expect(f.selection).toEqual({ provider: 'uwork-gen', model: 'alternate' })
    expect(f.secrets.has('UWORK_GEN')).toBe(false)
    expect(f.secrets.has('UWORK_SECOND')).toBe(true)
    await f.engine.recover()
    await f.engine.provision({ ...f.input, provider: 'uwork-third', credentialRef: 'UWORK_THIRD', binding: { ...f.input.binding, userId: 'other' } })
    expect(f.selection.provider).toBe('uwork-gen')
    await f.engine.recover()
    f.setDefault({ provider: 'uwork-third', model: 'allowed' })
    await f.engine.provision({ ...f.input, provider: 'uwork-fourth', credentialRef: 'UWORK_FOURTH', binding: { ...f.input.binding, orgId: 'other' } })
    expect(f.selection.provider).toBe('uwork-third')
  })
  it('keeps committed authorization after a refresh reader leaves until the verified identity ends', async () => {
    const f = fixture()
    const read = new AbortController()
    const route = await f.engine.provision({ ...f.input, signal: read.signal, identitySignal: f.controller.signal })
    const admitted = f.engine.requestSignal(route.provider, 'allowed', f.input.endpoint, route.profile)
    read.abort()
    expect(admitted?.aborted).toBe(false)
    f.controller.abort()
    expect(admitted?.aborted).toBe(true)
  })
  it.each([{ endpoint: 'http://gateway.example/v1' }, { credentialRef: 'PERSONAL_KEY' },
    { provider: 'personal' }, { authorizedModels: [] }, { capabilities: [{ id: 'allowed' }] }])('rejects unsafe or unverified input %j', async (patch) => {
    const f = fixture()
    await expect(f.engine.provision({ ...f.input, ...patch })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(f.journal).toBeUndefined()
  })
  it.each(['journal', 'secret', 'settings', 'commit', 'default'])('recovers an interruption after the %s write without half-ready admission', async (stage) => {
    const f = fixture(); f.setDefault({ provider: '', model: '' })
    if (stage === 'journal' || stage === 'commit') {
      const write = f.ports.writeJournal
      f.ports.writeJournal = async (next, expected) => {
        await write(next, expected)
        if (next?.phase === (stage === 'journal' ? 'staged' : 'committed')) throw new Error('interrupted')
      }
    } else if (stage === 'secret') {
      const write = f.ports.setSecret
      f.ports.setSecret = async (ref, secret) => { await write(ref, secret); throw new Error('interrupted') }
    } else if (stage === 'settings') {
      const write = f.ports.writeRoutes; let once = true
      f.ports.writeRoutes = async (providers, revision) => { await write(providers, revision); if (once) { once = false; throw new Error('interrupted') } }
    } else f.ports.saveDefault = async () => { throw new Error('interrupted') }
    await expect(f.engine.provision(f.input)).rejects.toThrow('interrupted')
    expect(() => f.engine.requestSignal('uwork-gen', 'allowed', f.input.endpoint, f.journal?.route.profile)).toThrow()
    await new ManagedRouteTransaction(f.ports).recover()
    expect(f.secrets.size).toBe(0); expect(f.journal).toBeUndefined(); expect(Object.keys(f.doc.providers)).toEqual(['personal'])
  })
  it('does not report ready if authorization expires while the conditional default save is pending', async () => {
    const f = fixture(); f.setDefault({ provider: '', model: '' })
    f.ports.saveDefault = async () => { f.controller.abort() }
    await expect(f.engine.provision(f.input)).rejects.toMatchObject({ code: 'REVOKED' })
    expect(f.secrets.size).toBe(0)
  })
  it('seals a route if its exact endpoint or raw profile changes', async () => {
    const f = fixture(); await f.engine.provision(f.input)
    f.engine.configurationChanged(f.doc.providers)
    const signal = f.engine.requestSignal('uwork-gen', 'allowed', f.input.endpoint, f.journal?.route.profile)!
    expect(() => f.engine.requestSignal('uwork-gen', 'allowed', 'https://foreign.example/v1', f.journal?.route.profile)).toThrow()
    expect(signal.aborted).toBe(true)
    f.engine.configurationChanged({})
    await f.engine.recover(); await f.engine.provision(f.input)
    const next = f.engine.requestSignal('uwork-gen', 'allowed', f.input.endpoint, f.journal?.route.profile)!
    f.engine.configurationChanged({ ...f.doc.providers, 'uwork-gen': { ...f.doc.providers['uwork-gen'], displayName: 'Changed' } })
    expect(next.aborted).toBe(true)
  })
  it.each([{ displayName: 'Custom' }, { models: [{ id: 'allowed', contextWindow: 8192, maxTokens: 1024, input: ['text' as const], reasoningEfforts: { high: 'high' } }] }])('retains user edits during cleanup %j', async (patch) => {
    const f = fixture(); await f.engine.provision(f.input)
    await f.ports.writeRoutes({ ...f.doc.providers, 'uwork-gen': { ...f.doc.providers['uwork-gen'], ...structuredClone(patch) } }, f.doc.revision)
    await f.engine.recover()
    expect(f.doc.providers['uwork-gen']).toBeDefined(); expect(f.secrets.size).toBe(0)
  })
})

it('replaces only an explicitly retired default with an authorized preferred model', async () => {
  const f = fixture()
  f.setDefault({ provider: 'deepseek-official', model: 'deepseek-flash' })
  await f.engine.provision({ ...f.input, retiredDefaultProviders: ['deepseek-official'] })
  expect(f.selection).toEqual({ provider: 'uwork-gen', model: 'allowed' })
})
