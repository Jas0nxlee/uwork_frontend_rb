/** Login-to-native-route orchestration. Secrets stay inside the identity callback. */
import { randomUUID } from 'node:crypto'
import type { IdentitySession } from '@deepseek-ai/dsh-uwork-enterprise/types'
import { GatewayRequestError } from '@deepseek-ai/dsh-uwork-gateway'
import type { GatewayClient } from '@deepseek-ai/dsh-uwork-gateway'
import type { GatewayModel } from '@deepseek-ai/dsh-uwork-gateway/types'
import type { PiAiModelProfile, PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'
import { ProvisioningError } from './transaction.ts'
import type { Binding, ProvisionInput } from './transaction.ts'
import type { LegacyTextCatalog, ModelCatalogEntry, ModelIdentityBinding, SyncResult } from './types.ts'

/** Durable per-account reconciliation identity written before a key creation POST. */
export interface KeyIntent { version: 1; orgId: string; userId: string; alias: string; outcome: 'pending' | 'unknown' }
/** Host-only collaborators; key-bearing client methods never cross Remote. */
export interface SyncPorts {
  /** Open an identity-owned lifetime without coupling it to a settings reader. */
  withSession<T>(this: void, run: (session: IdentitySession) => Promise<T>): Promise<T>
  client(this: void, session: IdentitySession): Pick<GatewayClient, 'readPublicEndpoint' | 'readPlanModels' | 'listKeys' | 'revealKey' | 'generateKey' | 'listEndpointModels'>
  readIntent(this: void, binding: Binding): Promise<KeyIntent | undefined>
  writeIntent(this: void, binding: Binding, intent: KeyIntent | undefined, expected?: KeyIntent): Promise<void>
  provision(this: void, input: ProvisionInput): Promise<string>
  needsModelSelection(this: void, provider: string, modelIds: readonly string[]): boolean
  revoke(this: void): void
}

/** Resolve authorized capability declarations from the endpoint or the release's explicit legacy catalog.
 * @param models - Bounded endpoint capability facts.
 * @param authorized - Explicit current account authorization ids.
 * @param legacy - Optional release-declared text/tool routes; omission requires complete endpoint declarations.
 * @param declarations - Per-model release capabilities; explicit endpoint fields take precedence.
 * @returns Native pi-ai declarations for the verified intersection.
 */
export function nativeCapabilities(
  models: readonly GatewayModel[], authorized: readonly string[],
  legacy?: LegacyTextCatalog, declarations: readonly ModelCatalogEntry[] = [],
): PiAiModelProfile[] {
  const allowed = new Set(authorized)
  const declared = new Set(legacy?.modelIds)
  const catalog = new Map(declarations.map(model => [model.id, model]))
  return models.flatMap((endpoint) => {
    if (!allowed.has(endpoint.id)) return []
    const entry = catalog.get(endpoint.id)
    const legacyModel = legacy !== undefined && declared.has(endpoint.id) ? {
      ...endpoint, contextWindow: endpoint.contextWindow ?? legacy.contextWindow,
      maxOutputTokens: endpoint.maxOutputTokens ?? legacy.maxOutputTokens,
      inputModalities: endpoint.inputModalities ?? ['text'], supportsTools: endpoint.supportsTools ?? true,
      supportsReasoning: endpoint.supportsReasoning ?? false,
    } : endpoint
    const model = { ...legacyModel, ...entry, ...endpoint }
    if (model.contextWindow === undefined || model.maxOutputTokens === undefined
      || !model.inputModalities?.includes('text') || model.supportsTools !== true || model.supportsReasoning === undefined) return []
    const reasoningEfforts: PiAiReasoningEfforts = {}
    if (model.supportsReasoning) {
      for (const level of model.reasoningLevels ?? []) {
        if (level === 'none') reasoningEfforts.off = 'none'
        else if (level === 'minimal' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max') reasoningEfforts[level] = level
      }
      if (!Object.keys(reasoningEfforts).length) return []
    }
    return [{ id: model.id, contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens,
      input: model.inputModalities.includes('image') && model.supportsVision !== false ? ['text', 'image'] : ['text'],
      reasoningEfforts: model.supportsReasoning ? reasoningEfforts : false,
      ...(entry === undefined ? {} : { compat: { maxTokensField: 'max_tokens' as const,
        supportsReasoningEffort: true, ...(entry.thinkingFormat === undefined ? {} : { thinkingFormat: entry.thinkingFormat }) } }) }]
  })
}

/** Serializes account synchronization; unknown POST outcomes remain durably blocked. */
export class ModelSynchronizer {
  private queue: Promise<unknown> = Promise.resolve(undefined)
  private epoch = 0
  constructor(private readonly ports: SyncPorts, private readonly preferredModels: readonly string[],
    private readonly legacyCatalog?: LegacyTextCatalog, private readonly modelCatalog: readonly ModelCatalogEntry[] = []) {}
  /** Read fresh authorization and provision a native route; key creation is explicitly opted in.
   * @param createKey - True only for an explicit user key-creation action.
   * @param signal - Calling operation lifetime.
   * @param expectedBinding - Account identity captured by an explicit creation confirmation.
   * @returns Safe synchronization status without credentials or reconciliation intents.
   */
  sync(createKey: boolean, signal: AbortSignal, expectedBinding?: ModelIdentityBinding): Promise<SyncResult> {
    const expected = expectedBinding === undefined ? undefined : { ...expectedBinding }
    if (expected === undefined) this.ports.revoke()
    let epoch = expected === undefined ? ++this.epoch : undefined
    const work = this.queue.then(() => this.ports.withSession<SyncResult>(async (session) => {
      const check = (): void => {
        signal.throwIfAborted(); session.signal.throwIfAborted()
        if (expected !== undefined && (session.orgId !== expected.orgId || session.userId !== expected.userId
          || session.generation !== expected.generation)) {
          throw new ProvisioningError('IDENTITY_CHANGED', 'Enterprise identity changed after key creation was confirmed')
        }
        if (epoch !== undefined && epoch !== this.epoch) throw new Error('Enterprise model synchronization was superseded')
      }
      check()
      if (expected !== undefined) { epoch = ++this.epoch; this.ports.revoke() }
      const binding: Binding = { orgId: session.orgId, userId: session.userId, generation: session.generation }
      const operation = AbortSignal.any([signal, session.signal])
      const client = this.ports.client({ ...session, signal: operation })
      const requests = [client.readPublicEndpoint(), client.readPlanModels(), client.listKeys()] as const
      await Promise.allSettled(requests)
      const [endpoint, plan, keys] = await Promise.all(requests)
      check()
      const intent = await this.ports.readIntent(binding)
      const reconciled = intent === undefined ? undefined : keys.find(key => key.alias === intent.alias && key.status === 'active')
      // An unresolved prior intent is never replaced with another create attempt.
      if (intent !== undefined && reconciled === undefined) return { status: 'key-outcome-unknown' }
      const selected = reconciled ?? keys.find(key => key.status === 'active')
      let apiKey: string
      if (selected !== undefined) {
        apiKey = await client.revealKey(selected.id)
        if (intent !== undefined) await this.ports.writeIntent(binding, undefined, intent)
      } else {
        if (!createKey) return { status: 'key-required' }
        const pending: KeyIntent = { version: 1, orgId: binding.orgId, userId: binding.userId,
          alias: `UWork-${randomUUID()}`, outcome: 'pending' }
        await this.ports.writeIntent(binding, pending)
        let dispatched = false
        try {
          check()
          dispatched = true
          apiKey = (await client.generateKey(pending.alias)).apiKey
          await this.ports.writeIntent(binding, undefined, pending)
        } catch (error) {
          if (!dispatched || (error instanceof GatewayRequestError && error.mutationOutcome === 'unchanged')) {
            await this.ports.writeIntent(binding, undefined, pending)
            throw error
          }
          await this.ports.writeIntent(binding, { ...pending, outcome: 'unknown' }, pending)
          return { status: 'key-outcome-unknown' }
        }
      }
      check()
      const catalog = await client.listEndpointModels(endpoint, apiKey)
      const authorizedModels = plan.unrestricted ? catalog.map(model => model.id) : plan.models
      const capabilities = nativeCapabilities(catalog, authorizedModels, this.legacyCatalog, this.modelCatalog)
      if (!capabilities.length) return { status: 'capabilities-required' }
      check()
      const id = randomUUID().replaceAll('-', '')
      const provider = await this.ports.provision({ binding, provider: `uwork-${id}`, credentialRef: `UWORK_${id.toUpperCase()}`, endpoint, apiKey,
        authorizedModels, capabilities, preferredModels: [...this.preferredModels],
        signal: operation, identitySignal: session.signal })
      check()
      const modelIds = capabilities.map(model => model.id)
      return { status: 'ready', provider, modelIds, needsModelSelection: this.ports.needsModelSelection(provider, modelIds) }
    }))
    this.queue = work.catch(() => {})
    return work
  }
}
