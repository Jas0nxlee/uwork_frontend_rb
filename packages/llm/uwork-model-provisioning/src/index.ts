/** Host-only enterprise model configuration through the native pi-ai adapter. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-uwork-enterprise'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { GatewayClient, GatewayRequestError } from '@deepseek-ai/dsh-uwork-gateway'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ManagedRouteTransaction, ProvisioningError, type Journal, type ProvisionInput } from './transaction.ts'
import { ModelSynchronizer, type KeyIntent } from './synchronizer.ts'
import type { ModelIdentityBinding, ModelProvisioningState, SyncResult } from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { uworkModelProvisioning: UworkModelProvisioning } }
interface Config {
  /** Native pi-ai profile entry whose provider dictionary stores owned routes. */
  settingsNamespace: string
  /** Optional HTTPS control-plane origin; omission disables account-to-model synchronization. */
  gatewayApiBaseUrl?: string
  /** Explicit HTTPS inference origins allowed to receive enterprise API keys. */
  allowedModelEndpointOrigins: string[]
  /** Deadline in milliseconds for each gateway request. */
  timeoutMs: number
  /** Maximum accepted bytes per gateway JSON response. */
  maxResponseBytes: number
  /** Maximum accepted items in a gateway catalog or key listing. */
  maxItems: number
  /** Release-owned initial model order; empty requires explicit user selection. */
  preferredModels: string[]
}
const journalKey = credentialKey('uwork-model-provisioning', 'route')

/** Reject malformed durable state without assuming it describes a working route. */
function journalFrom(value: unknown): Journal {
  if (value === null || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('phase' in value) || (value.phase !== 'staged' && value.phase !== 'committed') || !('route' in value)) {
    throw new ProvisioningError('RECOVERY_REQUIRED', 'Invalid enterprise route recovery record')
  }
  const route = value.route
  if (route === null || typeof route !== 'object' || !('provider' in route) || typeof route.provider !== 'string'
    || !/^uwork-[a-z0-9-]+$/.test(route.provider) || !('credentialRef' in route) || typeof route.credentialRef !== 'string'
    || !/^UWORK_[A-Z0-9_]+$/.test(route.credentialRef) || !('profile' in route) || route.profile === null || typeof route.profile !== 'object'
    || !('binding' in route) || route.binding === null || typeof route.binding !== 'object'
    || !('orgId' in route.binding) || typeof route.binding.orgId !== 'string'
    || !('userId' in route.binding) || typeof route.binding.userId !== 'string'
    || !('generation' in route.binding) || typeof route.binding.generation !== 'string') {
    throw new ProvisioningError('RECOVERY_REQUIRED', 'Invalid enterprise route recovery record')
  }
  const profile = route.profile
  if (!('apiKeyEnv' in profile) || profile.apiKeyEnv !== route.credentialRef || !('api' in profile) || profile.api !== 'openai-completions'
    || !('baseURL' in profile) || typeof profile.baseURL !== 'string' || !profile.baseURL.startsWith('https://')
    || !('models' in profile) || !Array.isArray(profile.models) || !profile.models.every((model: unknown) =>
    model !== null && typeof model === 'object' && 'id' in model && typeof model.id === 'string'
      && 'contextWindow' in model && Number.isSafeInteger(model.contextWindow) && 'maxTokens' in model && Number.isSafeInteger(model.maxTokens)
      && 'input' in model && Array.isArray(model.input) && model.input.every((item: unknown) => item === 'text' || item === 'image'))) {
    throw new ProvisioningError('RECOVERY_REQUIRED', 'Invalid enterprise route recovery profile')
  }
  // The journal is owner-written JSON; only owned provider/ref addresses are used during recovery.
  return value as Journal
}

/** Main-process capability. No Remote projection exposes input keys or credential records. */
export class UworkModelProvisioning extends TypertRemoteService {
  static inject = ['credentials', 'settings', 'agentDefaultModel']
  static Config = z.object({ settingsNamespace: z.string().default('llm-pi-ai'), gatewayApiBaseUrl: z.string(),
    allowedModelEndpointOrigins: z.array(String).default([]),
    timeoutMs: z.natural().min(1).max(2147483647).default(30000), maxResponseBytes: z.natural().min(1).max(2147483647).default(524288),
    maxItems: z.natural().min(1).max(2147483647).default(10000), preferredModels: z.array(String).default([]) })
  private readonly transaction: ManagedRouteTransaction
  private startup: Promise<void>
  private readonly synchronizer: ModelSynchronizer | undefined
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<SyncResult>>()
  private state: ModelProvisioningState = { status: 'idle' }
  private observation = 0
  constructor(ctx: Context, config: Config) {
    super(ctx, 'uworkModelProvisioning')
    const describeRoutes = () => {
      const descriptor = ctx.settings.describe().find(row => row.ns === config.settingsNamespace)
      if (descriptor === undefined) throw new ProvisioningError('RECOVERY_REQUIRED', 'Native model settings are unavailable')
      return descriptor
    }
    this.transaction = new ManagedRouteTransaction({
      readJournal: async () => {
        const record = await ctx.credentials.readRecord(journalKey)
        if (record === undefined) return undefined
        if (record.kind !== 'grant') throw new ProvisioningError('RECOVERY_REQUIRED', 'Unexpected enterprise route record kind')
        return record.payload === null ? undefined : journalFrom(record.payload)
      },
      writeJournal: async (journal, expected) => {
        // modifyRecord(undefined) means no write; a null payload is the owner's tombstone.
        await ctx.credentials.modifyRecord(journalKey, (current) => {
          if (current !== undefined && current.kind !== 'grant') throw new ProvisioningError('RECOVERY_REQUIRED', 'Unexpected enterprise route record kind')
          const actual = current?.kind === 'grant' && current.payload !== null ? journalFrom(current.payload) : undefined
          if (!isDeepStrictEqual(actual?.route, expected?.route)) {
            throw new ProvisioningError('ROUTE_CONFLICT', 'Another enterprise transaction owns the recovery record')
          }
          return Promise.resolve({ kind: 'grant', payload: journal ?? null })
        })
      },
      hasSecret: async ref => (await ctx.credentials.describe(credentialRef(ref))).configured,
      setSecret: (ref, key) => ctx.credentials.set(credentialRef(ref), key),
      deleteSecret: ref => ctx.credentials.unset(credentialRef(ref)),
      readRoutes: () => {
        const descriptor = describeRoutes()
        const value = descriptor.value as { providers?: Record<string, PiAiProviderProfile> }
        const user = descriptor.user as { providers?: Record<string, PiAiProviderProfile> }
        return { revision: descriptor.revision, providers: structuredClone(value.providers ?? {}),
          rawProviders: structuredClone(user.providers ?? {}) }
      },
      writeRoutes: (providers, revision) => {
        const descriptor = describeRoutes()
        const current = (descriptor.value as { providers?: Record<string, unknown> }).providers ?? {}
        const ops: import('@deepseek-ai/dsh-settings').SettingsPathOp[] = []
        for (const key of new Set([...Object.keys(current), ...Object.keys(providers)])) {
          if (JSON.stringify(current[key]) === JSON.stringify(providers[key])) continue
          ops.push(providers[key] === undefined ? { op: 'unset', path: ['providers', key] } : { op: 'set', path: ['providers', key], value: providers[key] })
        }
        return ctx.settings.mutate(config.settingsNamespace, ops, revision)
      },
      currentDefault: () => ctx.agentDefaultModel.currentSelection(),
      saveDefault: (selection, expected) => ctx.agentDefaultModel.saveSelection(selection, expected),
    })
    if (config.gatewayApiBaseUrl !== undefined) {
      const gatewayApiBaseUrl = config.gatewayApiBaseUrl
      const intentKey = (binding: { orgId: string; userId: string }) => credentialKey('uwork-model-provisioning',
        `key-intent-${createHash('sha256').update(JSON.stringify([binding.orgId, binding.userId])).digest('hex')}`)
      this.synchronizer = new ModelSynchronizer({
        withSession: (run, signal) => {
          const identity = ctx.get('uworkIdentity')
          if (identity === undefined) throw new ProvisioningError('REVOKED', 'Enterprise identity is unavailable')
          return identity.withSession(run, signal)
        },
        client: session => new GatewayClient({ apiBaseUrl: gatewayApiBaseUrl, timeoutMs: config.timeoutMs,
          allowedModelEndpointOrigins: config.allowedModelEndpointOrigins,
          maxResponseBytes: config.maxResponseBytes, maxItems: config.maxItems }, session),
        readIntent: async (binding) => {
          const record = await ctx.credentials.readRecord(intentKey(binding))
          if (record === undefined || (record.kind === 'grant' && record.payload === null)) return undefined
          if (record.kind !== 'grant') throw new ProvisioningError('RECOVERY_REQUIRED', 'Invalid enterprise key intent')
          const value = record.payload
          if (value === null || typeof value !== 'object' || !('version' in value) || value.version !== 1
            || !('orgId' in value) || value.orgId !== binding.orgId || !('userId' in value) || value.userId !== binding.userId
            || !('alias' in value) || typeof value.alias !== 'string' || !/^UWork-[a-f0-9-]{36}$/.test(value.alias)
            || !('outcome' in value) || (value.outcome !== 'pending' && value.outcome !== 'unknown')) {
            throw new ProvisioningError('RECOVERY_REQUIRED', 'Invalid enterprise key intent')
          }
          return value as KeyIntent
        },
        writeIntent: async (binding, intent, expected) => {
          await ctx.credentials.modifyRecord(intentKey(binding), (current) => {
            const payload = current?.kind === 'grant' ? current.payload : undefined
            const currentAlias = payload !== null && typeof payload === 'object' && 'alias' in payload ? payload.alias : undefined
            const empty = current === undefined || (current.kind === 'grant' && current.payload === null)
            if (expected === undefined ? !empty : currentAlias !== expected.alias) {
              throw new ProvisioningError('ROUTE_CONFLICT', 'Enterprise key creation is already pending')
            }
            return Promise.resolve({ kind: 'grant', payload: intent ?? null })
          })
        },
        provision: input => this.provision(input), revoke: () => { this.revoke() },
        needsModelSelection: (provider, modelIds) => {
          const selection = ctx.agentDefaultModel.currentSelection()
          return selection.provider === '' || selection.model === ''
            || (selection.provider.startsWith('uwork-') && (selection.provider !== provider || !modelIds.includes(selection.model)))
        },
      }, config.preferredModels)
      ctx.inject(['uworkIdentity'], (child) => {
        child.on('uwork-identity/changed', (state) => {
          this.observation++
          this.revoke()
          this.state = { status: state.status === 'authenticated' ? 'idle' : 'signed-out' }
          if (state.status === 'authenticated') void this.refresh(this.lifetime.signal)
        })
      })
    }
    ctx.effect(() => ctx.on('llm-pi-ai/request-signal', (request, next) => {
      const descriptor = ctx.settings.describe().find(row => row.ns === config.settingsNamespace)
      const user = descriptor?.user as { providers?: Record<string, PiAiProviderProfile> } | undefined
      const own = this.transaction.requestSignal(request.provider, request.model, request.baseURL, user?.providers?.[request.provider])
      const inherited = next()
      return own === undefined ? inherited : inherited === undefined ? own : AbortSignal.any([own, inherited])
    }))
    ctx.effect(() => ctx.on('llm-pi-ai/discovery-signal', (request, next) => {
      if (request.provider?.startsWith('uwork-')) {
        throw new ProvisioningError('REVOKED', 'Managed models are discovered through enterprise authorization; refresh the account model catalog')
      }
      return next()
    }))
    ctx.effect(() => ctx.on('settings/document-updated', (ns) => {
      if (ns !== config.settingsNamespace) return
      const descriptor = ctx.settings.describe().find(row => row.ns === config.settingsNamespace)
      const user = descriptor?.user as { providers?: Record<string, PiAiProviderProfile> } | undefined
      this.transaction.configurationChanged(user?.providers ?? {})
    }))
    ctx.effect(() => async () => {
      this.lifetime.abort(); this.transaction.revoke(); await Promise.allSettled([this.startup, ...this.pending])
    })
    this.startup = this.transaction.recover()
    // Keep rejection observable to provision/recover without an unhandled background rejection.
    void this.startup.catch(() => {})
  }
  /** Provision fresh identity-scoped material supplied only by a Host identity callback.
   * @param input - Host-only identity, capability and secret material.
   */
  async provision(input: ProvisionInput): Promise<void> {
    await this.startup
    await this.transaction.recover()
    await this.transaction.provision(input)
  }
  /** Close admission synchronously; durable recovery removes only this plugin's owned route. */
  revoke(): void { this.transaction.revoke() }
  /** Retry startup reconciliation after the credential/settings backend is repaired. */
  async recover(): Promise<void> { this.startup = this.transaction.recover(); await this.startup }
  /** Host orchestration; createKey=true is reserved for an explicit user key-creation action.
   * @param createKey - Whether the user explicitly requested key creation.
   * @param signal - Optional caller cancellation.
   * @param expectedBinding - Account identity captured by an explicit key confirmation.
   * @returns Safe synchronization result with no credential values.
   */
  async syncCurrent(createKey: boolean = false, signal?: AbortSignal, expectedBinding?: ModelIdentityBinding): Promise<SyncResult> {
    if (this.synchronizer === undefined) throw new ProvisioningError('INVALID_INPUT', 'Enterprise gateway provisioning is not configured')
    const work = this.synchronizer.sync(createKey,
      AbortSignal.any([this.lifetime.signal, ...signal === undefined ? [] : [signal]]), expectedBinding)
    this.pending.add(work)
    try { return await work } finally { this.pending.delete(work) }
  }
  /** Read current safe provisioning state and observe cross-process identity revocation.
   * @param signal - Caller cancellation.
   * @returns Detached safe current status.
   */
  @Remote
  async getState(signal: AbortSignal): Promise<ModelProvisioningState> {
    signal.throwIfAborted()
    const identity = this.ctx.get('uworkIdentity')
    if (identity !== undefined) {
      try {
        const state = await identity.getState()
        if (state.status !== 'authenticated') { this.revoke(); this.state = { status: 'signed-out' } }
        else if (this.state.status === 'idle') return await this.refresh(signal)
      } catch { this.revoke(); this.state = { status: 'error', reason: 'identity' } }
    }
    signal.throwIfAborted()
    return structuredClone(this.state)
  }
  /** Refresh authorization and native routes without creating an API key.
   * @param signal - Caller cancellation.
   * @returns Safe refreshed status or classified failure.
   */
  @Remote
  async refresh(signal: AbortSignal): Promise<ModelProvisioningState> { return this.runSync(false, signal) }
  /** Explicit user action; a durable unknown key outcome prevents another create POST.
   * @param expectedBinding - Safe account identity captured by the confirmation dialog.
   * @param signal - Caller cancellation.
   * @returns Safe creation/reconciliation status or classified failure.
   */
  @Remote
  async createManagedKey(expectedBinding: ModelIdentityBinding, signal: AbortSignal): Promise<ModelProvisioningState> {
    return this.runSync(true, signal, expectedBinding)
  }
  private async runSync(createKey: boolean, signal: AbortSignal, expectedBinding?: ModelIdentityBinding): Promise<ModelProvisioningState> {
    const observation = ++this.observation
    this.state = { status: 'syncing' }
    try {
      if (!createKey) {
        try { await this.startup } catch { await this.recover() }
      }
      const next = await this.syncCurrent(createKey, signal, expectedBinding)
      if (observation === this.observation) this.state = next
    }
    catch (error) {
      if (observation === this.observation) {
        this.state = { status: 'error', reason: error instanceof GatewayRequestError ? 'gateway'
          : error instanceof ProvisioningError ? error.code === 'IDENTITY_CHANGED' ? 'identity' : 'storage' : 'unavailable' }
      }
    }
    return structuredClone(this.state)
  }
}
export default UworkModelProvisioning
