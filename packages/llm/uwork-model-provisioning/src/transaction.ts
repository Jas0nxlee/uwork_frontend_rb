/** Host-only managed route transaction. Settings contain references, never secrets. */
import type { PiAiModelProfile, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { isDeepStrictEqual } from 'node:util'

/** Identity generation owning one managed route. */
export interface Binding { orgId: string; userId: string; generation: string }
/** Default model selection projected without Session state. */
export interface Selection { provider: string; model: string }
/** Managed settings facts; the credential value is never part of this record. */
export interface ManagedRoute {
  binding: Binding
  provider: string
  credentialRef: string
  profile: PiAiProviderProfile & { models: PiAiModelProfile[] }
}
/** Durable recovery point around credential and settings commits. */
export interface Journal { version: 1; phase: 'staged' | 'committed'; route: ManagedRoute }
/** Detached native provider dictionary and its settings revision. */
export interface RouteDocument {
  revision: number
  providers: Record<string, PiAiProviderProfile>
  rawProviders?: Record<string, PiAiProviderProfile>
}
/** Ports deliberately remain Host-only; a Renderer must never receive this object. */
export interface TransactionPorts {
  readJournal(this: void): Promise<Journal | undefined>
  writeJournal(this: void, journal: Journal | undefined, expected?: Journal): Promise<void>
  hasSecret(this: void, ref: string): Promise<boolean>
  setSecret(this: void, ref: string, key: string): Promise<void>
  deleteSecret(this: void, ref: string): Promise<void>
  readRoutes(this: void): RouteDocument
  writeRoutes(this: void, providers: Record<string, PiAiProviderProfile>, revision: number): Promise<void>
  currentDefault(this: void): Selection
  saveDefault(this: void, selection: Selection, expected: Selection): Promise<void>
}
/** Host-only fresh authorization and secret material for one transaction. */
export interface ProvisionInput {
  binding: Binding
  /** Fresh unguessable, POSIX-safe reference for this transaction. */
  credentialRef: string
  provider: string
  endpoint: string
  apiKey: string
  authorizedModels: readonly string[]
  /** Explicit endpoint or release capability declarations, never inferred from model names. */
  capabilities: readonly PiAiModelProfile[]
  preferredModels: readonly string[]
  /** Explicitly retired product routes eligible for default-selection replacement. */
  retiredDefaultProviders?: readonly string[]
  signal: AbortSignal
  /** Committed authorization lifetime; when omitted, the operation signal owns it too. */
  identitySignal?: AbortSignal
}
/** Safe structured provisioning failure; causes remain Host-only. */
export class ProvisioningError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'REVOKED' | 'RECOVERY_REQUIRED' | 'ROUTE_CONFLICT' | 'IDENTITY_CHANGED', message: string, options?: ErrorOptions) { super(message, options); this.name = 'ProvisioningError' }
}
function sameProfile(a: PiAiProviderProfile | undefined, b: ManagedRoute['profile']): boolean {
  return isDeepStrictEqual(a, b)
}
function live(signal: AbortSignal): void { if (signal.aborted) throw new ProvisioningError('REVOKED', 'Enterprise session is no longer active') }

/** Serializes settings/secret commits and leaves an explicit durable repair point on interruption. */
export class ManagedRouteTransaction {
  private queue: Promise<unknown> = Promise.resolve(undefined)
  private epoch = 0
  private previousRoute: ManagedRoute | undefined
  private active: { route: ManagedRoute; controller: AbortController } | undefined
  constructor(private readonly ports: TransactionPorts) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run)
    this.queue = result.catch(() => {})
    return result
  }
  /** Immediately seals a route and aborts in-flight calls, before asynchronous cleanup. */
  revoke(): void { this.epoch++; this.active?.controller.abort(); this.active = undefined }
  /** Fail closed for stale/unknown route generations, including restored settings before login.
   * @param provider - Native provider selected by the captured request.
   * @param model - Exact selected model id.
   * @param baseURL - Captured native request endpoint.
   * @param currentProfile - Current raw owner settings, excluding schema defaults.
   * @returns Active route lifetime, or undefined for a personal provider.
   */
  requestSignal(
    provider: string, model: string, baseURL: string, currentProfile: PiAiProviderProfile | undefined,
  ): AbortSignal | undefined {
    if (!provider.startsWith('uwork-')) return undefined
    const active = this.active
    if (active === undefined || active.controller.signal.aborted || active.route.provider !== provider
      || active.route.profile.baseURL !== baseURL || !sameProfile(currentProfile, active.route.profile)
      || !active.route.profile.models.some(item => item.id === model)) {
      this.revoke()
      throw new ProvisioningError('REVOKED', 'Enterprise model authorization expired; select an authorized model')
    }
    return active.controller.signal
  }
  /** Cancel live calls when settings change the owned route.
   * @param providers - Current raw provider dictionary.
   */
  configurationChanged(providers: Record<string, PiAiProviderProfile>): void {
    if (this.active !== undefined && !sameProfile(providers[this.active.route.provider], this.active.route.profile)) this.revoke()
  }
  /** Commit a fresh authorized route or compensate its staged writes.
   * @param input - Host-only identity, capability and secret material.
   * @returns Committed managed settings facts after admission opens.
   */
  provision(input: ProvisionInput): Promise<ManagedRoute> {
    this.revoke()
    const epoch = this.epoch
    const identitySignal = input.identitySignal ?? input.signal
    const check = (): void => {
      live(input.signal)
      live(identitySignal)
      if (epoch !== this.epoch) throw new ProvisioningError('REVOKED', 'Enterprise provisioning was superseded')
    }
    return this.serial(async () => {
      check()
      if (await this.ports.readJournal()) throw new ProvisioningError('RECOVERY_REQUIRED', 'Reconcile the previous enterprise route before provisioning')
      const endpoint = new URL(input.endpoint)
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
        || !/^uwork-[a-z0-9-]+$/.test(input.provider) || !/^UWORK_[A-Z0-9_]+$/.test(input.credentialRef)
        || input.apiKey.length === 0 || !input.binding.orgId || !input.binding.userId || !input.binding.generation) {
        throw new ProvisioningError('INVALID_INPUT', 'Invalid managed route configuration')
      }
      const authorized = new Set(input.authorizedModels)
      const models = input.capabilities.filter(model => authorized.has(model.id))
      if (!models.length || models.some(model => !model.contextWindow || !model.maxTokens || !model.input?.length)) {
        throw new ProvisioningError('INVALID_INPUT', 'Authorized models require verified token limits and modalities')
      }
      const previous = this.previousRoute
      const sameAccount = previous !== undefined && previous.binding.orgId === input.binding.orgId
        && previous.binding.userId === input.binding.userId
      const provider = sameAccount ? previous.provider : input.provider
      const document = this.ports.readRoutes()
      if (document.providers[provider] !== undefined
        || Object.values(document.providers).some(profile => profile.apiKeyEnv === input.credentialRef)) {
        throw new ProvisioningError('ROUTE_CONFLICT', 'Managed route or credential reference is already configured')
      }
      if (await this.ports.hasSecret(input.credentialRef)) throw new ProvisioningError('ROUTE_CONFLICT', 'Enterprise credential reference is already configured')
      const route: ManagedRoute = { binding: { ...input.binding }, provider, credentialRef: input.credentialRef,
        profile: { displayName: 'UWork', api: 'openai-completions', baseURL: endpoint.href,
          apiKeyEnv: input.credentialRef, models: structuredClone(models) } }
      const journal: Journal = { version: 1, phase: 'staged', route }
      await this.ports.writeJournal(journal)
      try {
        check()
        await this.ports.setSecret(route.credentialRef, input.apiKey)
        check()
        await this.ports.writeRoutes({ ...document.providers, [route.provider]: route.profile }, document.revision)
        check()
        await this.ports.writeJournal({ ...journal, phase: 'committed' }, journal)
        check()
        const controller = new AbortController()
        identitySignal.addEventListener('abort', () => { controller.abort() }, { once: true, signal: controller.signal })
        this.active = { route, controller }
        const current = this.ports.currentDefault()
        const preferred = input.preferredModels.find(id => models.some(model => model.id === id))
        // An existing personal default or a revoked Session selection is never rewritten.
        const ownedDefault = sameAccount && current.provider === route.provider
        const retainsChoice = ownedDefault && models.some(model => model.id === current.model)
        if (preferred !== undefined && !retainsChoice && (ownedDefault || current.provider === route.provider || current.provider === ''
          || input.retiredDefaultProviders?.includes(current.provider))) {
          await this.ports.saveDefault({ provider: route.provider, model: preferred }, current)
        }
        check()
        return route
      } catch (cause) {
        this.revoke()
        try { await this.removeOwned(journal) } catch (cleanup) {
          throw new ProvisioningError('RECOVERY_REQUIRED', 'Enterprise provisioning needs startup reconciliation', { cause: cleanup })
        }
        throw cause
      }
    })
  }
  /** A restored route is never marked ready without fresh authorization and fresh provisioning. */
  recover(): Promise<void> {
    this.revoke()
    return this.serial(async () => {
      const journal = await this.ports.readJournal()
      if (journal) { await this.removeOwned(journal); this.previousRoute = journal.route }
    })
  }
  private async removeOwned(journal: Journal): Promise<void> {
    const document = this.ports.readRoutes()
    if (sameProfile((document.rawProviders ?? document.providers)[journal.route.provider], journal.route.profile)) {
      const providers = { ...document.providers }; Reflect.deleteProperty(providers, journal.route.provider)
      await this.ports.writeRoutes(providers, document.revision)
    }
    await this.ports.deleteSecret(journal.route.credentialRef)
    await this.ports.writeJournal(undefined, journal)
  }
}
