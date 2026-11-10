/** Enterprise issuer authentication, opaque credential grants and generation-scoped Host capabilities. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-native-authorization'
import type { NativeAuthorizationAttemptId, NativeAuthorizationState } from '@deepseek-ai/dsh-native-authorization/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { IdentityError } from './errors.ts'
import { parseConfiguration, parseHandoff, parseIdentity, request } from './protocol.ts'
import type { Options, VerifiedIdentity } from './protocol.ts'
import type { IdentityGeneration, IdentitySession, IdentityState, NativeSignInAttempt, Organization, SignInAttemptId } from './types.ts'
export { IdentityError } from './errors.ts'

/** Deployment allowlist and bounded request/lifecycle settings; all are validated before registration. */
export interface Config {
  /** Pure HTTPS origin of the enterprise issuer. */
  apiBaseUrl: string
  /** Explicit public organization and callback allowlist. */
  organizations: Organization[]
  /** Initially selected organization; must exist in the allowlist. */
  defaultOrgId: string
  /** Per-request deadline in milliseconds; defaults to 15000. */
  requestTimeoutMs?: number
  /** Maximum local sign-in lifetime in milliseconds; defaults to 300000. */
  attemptTimeoutMs?: number
  /** Authorization-flow handoff polling interval in milliseconds; defaults to 1500. */
  pollIntervalMs?: number
  /** Cross-process grant observation interval in milliseconds; defaults to 1000. */
  observationIntervalMs?: number
  /** Complete issuer JSON response byte limit; defaults to 65536. */
  maxResponseBytes?: number
}

const grantSchema = z.discriminatedUnion('state', [
  z.object({ version: z.literal(1), state: z.literal('empty'), generation: z.uuid() }).strict(),
  z.object({ version: z.literal(1), state: z.literal('session'), generation: z.uuid(), orgId: z.string().min(1).max(256), token: z.string().min(1).max(16384), userId: z.string().min(1).max(256) }).strict(),
])
type Grant = z.infer<typeof grantSchema>
interface Attempt {
  view: NativeSignInAttempt
  org: Organization
  generation: string
  controller: AbortController
  handoff?: { id: string; secret: string }
  submitted: boolean
  busy: boolean
  running?: Promise<IdentityState>
}
interface Active { value: VerifiedIdentity; generation: IdentityGeneration; controller: AbortController }
const key = credentialKey('uwork-enterprise', 'identity')

function grant(record: CredentialRecord | undefined): Grant | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant') throw new IdentityError('PROTOCOL', 'Stored enterprise identity record is invalid')
  const result = grantSchema.safeParse(record.payload)
  if (!result.success) throw new IdentityError('PROTOCOL', 'Stored enterprise identity grant is invalid; sign out and sign in again')
  return result.data
}
function isAborted(signal: AbortSignal): boolean { return signal.aborted }
function generation(): IdentityGeneration { return brandString<IdentityGeneration>(randomUUID()) }
function tombstone(id: string): CredentialRecord { return { kind: 'grant', payload: { version: 1, state: 'empty', generation: id } satisfies Grant } }

declare module '@deepseek-ai/cordis' {
  interface Context { uworkIdentity: EnterpriseIdentity }
  interface Events {
    /**
     * Emitted when safe identity changes or is withdrawn. Never contains credentials.
     * @mode emit
     * @param state - safe identity projection after the transition.
     */
    'uwork-identity/changed'(state: IdentityState): void
  }
}

/** Owns only enterprise identity. Personal provider settings and company/personal skills are outside this service. */
export default class EnterpriseIdentity extends TypertRemoteService {
  static inject = ['credentials', 'authorization', 'nativeAuthorization']
  static Config = Schema.object({
    apiBaseUrl: Schema.string().required(),
    organizations: Schema.array(Schema.object({
      orgId: Schema.string().required(), corpId: Schema.string().required(), agentId: Schema.string().required(),
      label: Schema.string(), callbackUrl: Schema.string().required(),
    })).required(),
    defaultOrgId: Schema.string().required(),
    requestTimeoutMs: Schema.natural().min(1).max(120000).default(15000),
    attemptTimeoutMs: Schema.natural().min(1).max(3600000).default(300000),
    pollIntervalMs: Schema.natural().min(1).max(60000).default(1500),
    observationIntervalMs: Schema.natural().min(1).max(60000).default(1000),
    maxResponseBytes: Schema.natural().min(1).max(1048576).default(65536),
  })
  private readonly options: Options
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private nativeFailure: { id: SignInAttemptId; orgId: string; reason: 'expired' } | undefined
  private intent: string | undefined
  private attempt: Attempt | undefined
  private active: Active | undefined
  private restoring = false
  private restoration: Promise<IdentityState> | undefined
  private restoreController: AbortController | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'uworkIdentity')
    this.options = parseConfiguration(config)
    ctx.effect(() => ctx.nativeAuthorization.register({
      getState: async () => { await this.getState(); return this.nativeState() },
      start: async (choice, signal) => {
        const value = await this.startSignIn(choice, signal)
        return { ...value, id: brandString<NativeAuthorizationAttemptId>(value.id) }
      },
      complete: async (id, url, signal) => { await this.completeSignIn(id, url, signal); return this.nativeState() },
      poll: async (id, signal) => { await this.pollSignIn(id, signal); return this.nativeState() },
      cancel: async (id) => { await this.cancelSignIn(id); return this.nativeState() },
    }))
    ctx.effect(() => ctx.authorization.registerFlow({
      key, label: 'UWork enterprise identity',
      methods: this.options.organizations.map(org => ({ id: org.orgId, label: org.label ?? org.orgId })) as [
        { id: string; label: string }, ...Array<{ id: string; label: string }>,
      ],
      run: async (session) => {
        const attempt = await this.startSignIn(session.method, session.signal)
        session.notify({ message: 'Continue enterprise sign-in', url: attempt.authorizationUrl })
        try {
          while (true) {
            session.signal.throwIfAborted()
            const state = await this.pollSignIn(attempt.id, session.signal)
            if (state.status === 'authenticated') return
            await delay(this.options.pollIntervalMs, undefined, { signal: AbortSignal.any([session.signal, this.lifetime.signal]) })
          }
        } finally { await this.cancelSignIn(attempt.id) }
      },
    }))
    ctx.effect(() => {
      const timer = setInterval(() => {
        void this.track(this.observe(true)).catch(() => { /* State is withdrawn before an observation failure reaches here. */ })
      }, this.options.observationIntervalMs)
      timer.unref()
      return async () => {
        clearInterval(timer)
        this.lifetime.abort(new IdentityError('DISPOSED', 'Enterprise identity service stopped'))
        this.invalidate()
        await Promise.allSettled([...this.pending])
      }
    })
  }

  /**
   * Safe configured organization choices; no callbacks, issuer secrets or tokens.
   * @returns public organizations and the configured default.
   */
  @Remote listOrganizations(): { defaultOrgId: string; organizations: Array<{ orgId: string; label: string }> } {
    return {
      defaultOrgId: this.options.defaultOrgId,
      organizations: this.options.organizations.map(org => ({ orgId: org.orgId, label: org.label ?? org.orgId })),
    }
  }

  /**
   * Observes revocation and verifies stored grants before publishing an authenticated state.
   * @returns token-free state, or restoring while another verification is in progress.
   * @throws IdentityError when storage or issuer verification fails.
   */
  @Remote async getState(): Promise<IdentityState> {
    this.lifetime.signal.throwIfAborted()
    await this.track(this.observe())
    if (this.restoration !== undefined) return this.state()
    if (this.active === undefined && this.attempt === undefined) return this.restoreSession()
    return this.state()
  }

  /**
   * Publishes safe state initially and after identity changes; intermediate updates may coalesce.
   * @param signal - subscriber cancellation, combined with plugin lifetime.
   * @returns issuer-verified current state followed by safe changes; ends on cancellation.
   */
  @Remote({ mode: 'stream' })
  async *watchState(signal: AbortSignal): AsyncIterable<IdentityState> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    let dirty = true
    let resume: (() => void) | undefined
    const changed = () => { dirty = true; resume?.() }
    const dispose = this.ctx.on('uwork-identity/changed', changed)
    const cancel = () => { dispose(); changed() }
    lifetime.addEventListener('abort', cancel, { once: true })
    try {
      while (!isAborted(lifetime)) {
        if (dirty) {
          dirty = false
          const state = await this.getState()
          if (isAborted(lifetime)) break
          yield state
        } else {
          await new Promise<void>((resolve) => { resume = resolve })
        }
      }
    } finally {
      dispose()
      lifetime.removeEventListener('abort', cancel)
    }
  }

  /** Durable tombstone prevents older login/refresh writers from resurrecting a logged-out session. */
  @Remote async signOut(): Promise<void> {
    this.lifetime.signal.throwIfAborted()
    const id = generation()
    this.nativeFailure = undefined
    this.intent = id
    this.invalidate()
    await this.track(this.ctx.credentials.modifyRecord(key, () => Promise.resolve(tombstone(id))))
    if (this.intent === id) { this.invalidate(); this.publish() }
  }

  /**
   * Host/Main only. Durably revokes the previous generation before contacting the issuer.
   * @param orgId - exact allowlisted organization ID.
   * @param signal - optional caller cancellation; without it plugin lifetime still applies.
   * @returns private native navigation without handoff secret or token.
   * @throws IdentityError for an unknown organization, stale attempt or issuer failure.
   */
  async startSignIn(orgId: string, signal?: AbortSignal): Promise<NativeSignInAttempt> {
    return this.track(this.start(orgId, signal))
  }
  private async start(orgId: string, signal?: AbortSignal): Promise<NativeSignInAttempt> {
    this.lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
    const org = this.options.organizations.find(value => value.orgId === orgId)
    if (org === undefined) throw new IdentityError('CONFIG', 'Organization is not allowed')
    this.nativeFailure = undefined
    this.invalidate()
    const id = generation()
    this.intent = id
    await this.ctx.credentials.modifyRecord(key, () => Promise.resolve(tombstone(id)))
    this.lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
    if (this.intent !== id) throw new IdentityError('STALE', 'Enterprise sign-in is no longer current')
    const controller = new AbortController()
    const combined = AbortSignal.any([controller.signal, this.lifetime.signal, ...(signal === undefined ? [] : [signal])])
    const expiresAt = Date.now() + this.options.attemptTimeoutMs
    const value: Attempt = { org, generation: id, controller, submitted: false, busy: false, view: { id: brandString<SignInAttemptId>(randomUUID()), authorizationUrl: '', callbackUrl: '', allowedNavigationOrigins: [], expiresAt } }
    this.attempt = value
    this.publish()
    try {
      const reply = await request(this.options, '/api/auth/handoff/start', { org_id: orgId }, combined)
      if (reply.status === 201) {
        const handoff = parseHandoff(reply.body, Date.now(), expiresAt)
        value.handoff = { id: handoff.id, secret: handoff.secret }
        value.view.id = brandString<SignInAttemptId>(handoff.id)
        value.view.expiresAt = handoff.expiresAt
      } else if (reply.status !== 404 && reply.status !== 405 && reply.status !== 501) {
        throw new IdentityError('HTTP', 'Enterprise sign-in could not be started', reply.status)
      }
      await this.check(value, combined)
      const callback = new URL(org.callbackUrl)
      callback.searchParams.set('uwork_nonce', value.view.id)
      const authorization = new URL('https://login.work.weixin.qq.com/wwlogin/sso/login')
      authorization.search = new URLSearchParams({ login_type: 'CorpApp', appid: org.corpId, agentid: org.agentId, redirect_uri: callback.href, state: org.orgId, lang: 'zh' }).toString()
      value.view.authorizationUrl = authorization.href
      value.view.callbackUrl = callback.href
      value.view.allowedNavigationOrigins = [authorization.origin, 'https://open.work.weixin.qq.com', callback.origin]
      return { ...value.view, allowedNavigationOrigins: [...value.view.allowedNavigationOrigins] }
    } catch (error) {
      if (this.attempt === value) { this.retireAttempt(); this.publish() }
      throw error
    }
  }

  /**
   * Main-only callback ingestion. Exactly one code submission is admitted per attempt.
   * @param attemptId - current native attempt ID.
   * @param callbackUrl - Main-intercepted URL; never forward through application Renderer.
   * @param signal - optional caller cancellation, combined with the attempt lifetime.
   * @returns verified public state after the credential grant commits.
   * @throws IdentityError for an invalid callback, expiry, duplicate submission or issuer failure.
   */
  async completeSignIn(attemptId: string, callbackUrl: string, signal?: AbortSignal): Promise<IdentityState> {
    return this.track(this.complete(attemptId, callbackUrl, signal))
  }
  private async complete(attemptId: string, callbackUrl: string, signal?: AbortSignal): Promise<IdentityState> {
    const attempt = this.requireAttempt(attemptId)
    const combined = this.signal(attempt, signal)
    await this.check(attempt, combined)
    let url: URL
    try { url = new URL(callbackUrl) } catch { throw new IdentityError('CALLBACK', 'Invalid enterprise sign-in callback') }
    const expected = new URL(attempt.org.callbackUrl)
    const single = (name: string) => url.searchParams.getAll(name).length === 1 ? url.searchParams.get(name) : null
    const code = single('code')
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash || single('state') !== attempt.org.orgId || single('uwork_nonce') !== attempt.view.id || code === null || code.length < 1 || code.length > 4096) {
      throw new IdentityError('CALLBACK', 'Enterprise sign-in callback did not match the active attempt')
    }
    if (attempt.submitted) throw new IdentityError('STALE', 'Enterprise sign-in was already submitted')
    attempt.submitted = true
    if (attempt.running !== undefined) {
      await attempt.running
      if (this.active?.generation === attempt.generation) return this.state()
      await this.check(attempt, combined)
    }
    attempt.busy = true
    try {
      const response = await request(this.options, '/api/auth/login', { code, org_id: attempt.org.orgId }, combined)
      if (response.status !== 200) throw new IdentityError('HTTP', 'Enterprise sign-in was rejected', response.status)
      const identity = parseIdentity(response.body, attempt.org.orgId, Date.now())
      // Even an email-auth response or unverified local JWT must pass the issuer's refresh verification.
      const verified = await this.verify(identity, combined)
      await this.commit(attempt, verified, combined)
      return this.state()
    } finally { attempt.busy = false }
  }

  /**
   * Main-only polling. 202 is pending; transient and protocol failures remain failures.
   * @param attemptId - current native attempt ID.
   * @param signal - optional caller cancellation, combined with attempt lifetime.
   * @returns public state; pending attempts remain signed out.
   */
  async pollSignIn(attemptId: string, signal?: AbortSignal): Promise<IdentityState> {
    const attempt = this.requireAttempt(attemptId)
    if (attempt.running !== undefined) return attempt.running
    const operation = this.track(this.poll(attemptId, signal))
    attempt.running = operation
    void operation.then(() => { delete attempt.running }, () => { delete attempt.running })
    return operation
  }
  private async poll(attemptId: string, signal?: AbortSignal): Promise<IdentityState> {
    const attempt = this.requireAttempt(attemptId)
    const combined = this.signal(attempt, signal)
    await this.check(attempt, combined)
    if (attempt.handoff === undefined || attempt.busy) return this.state()
    attempt.busy = true
    try {
      const response = await request(this.options, '/api/auth/handoff/claim', { handoff_id: attempt.handoff.id, handoff_secret: attempt.handoff.secret }, combined)
      if (response.status === 202) return this.state()
      if (response.status !== 200) throw new IdentityError('HTTP', 'Enterprise sign-in handoff could not be claimed', response.status)
      const identity = parseIdentity(response.body, attempt.org.orgId, Date.now())
      await this.commit(attempt, await this.verify(identity, combined), combined)
      return this.state()
    } finally { attempt.busy = false }
  }

  /**
   * Cancels only this attempt's generation and awaits owned work; newer identity is left intact.
   * @param attemptId - attempt being withdrawn; an already retired ID is a no-op.
   */
  async cancelSignIn(attemptId: string): Promise<void> {
    if (this.nativeFailure?.id === attemptId) { this.nativeFailure = undefined; this.publish() }
    const attempt = this.attempt
    if (attempt === undefined || attempt.view.id !== attemptId) return
    const pending = [...this.pending]
    this.retireAttempt()
    await this.track(this.ctx.credentials.modifyRecord(key, current => Promise.resolve(
      grant(current)?.generation === attempt.generation ? tombstone(generation()) : undefined,
    )))
    await Promise.allSettled(pending)
    this.publish()
  }

  /**
   * Restores after issuer refresh, preserving stored user and organization. Network errors never authenticate.
   * @param signal - optional caller cancellation; concurrent callers join the first verification.
   * @returns verified safe state, or signed-out for an empty or issuer-revoked grant.
   * @throws IdentityError for invalid grants, stale generations or issuer failure.
   */
  restoreSession(signal?: AbortSignal): Promise<IdentityState> {
    if (this.restoration !== undefined) return this.restoration
    const operation = this.track(this.restore(signal))
    this.restoration = operation
    void operation.then(() => { this.restoration = undefined }, () => { this.restoration = undefined })
    return operation
  }
  private async restore(signal?: AbortSignal): Promise<IdentityState> {
    this.lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
    this.restoring = true
    const controller = new AbortController()
    this.restoreController = controller
    try {
      const stored = grant(await this.ctx.credentials.readRecord(key))
      if (stored === undefined || stored.state === 'empty') return this.stateWithoutRestoring()
      if (!this.options.organizations.some(org => org.orgId === stored.orgId)) throw new IdentityError('CONFIG', 'Stored organization is not allowed')
      const combined = AbortSignal.any([controller.signal, this.lifetime.signal, ...(signal === undefined ? [] : [signal])])
      let verified!: VerifiedIdentity
      const outcome = { denied: false }
      // The credential lock includes token rotation: another Host must refresh the latest stored token.
      await this.ctx.credentials.modifyRecord(key, async (current) => {
        combined.throwIfAborted()
        const latest = grant(current)
        if (latest?.state !== 'session' || latest.generation !== stored.generation) throw new IdentityError('STALE', 'Enterprise identity changed during verification')
        const response = await request(this.options, '/api/auth/refresh', {}, combined, latest.token)
        if (response.status === 401 || response.status === 403) {
          outcome.denied = true
          return tombstone(generation())
        }
        if (response.status !== 200) throw new IdentityError('HTTP', 'Enterprise session could not be verified', response.status)
        const identity = parseIdentity(response.body, latest.orgId, Date.now())
        if (identity.userId !== latest.userId) throw new IdentityError('PROTOCOL', 'Issuer changed the enterprise user during verification')
        combined.throwIfAborted()
        verified = identity
        return { kind: 'grant', payload: { version: 1, state: 'session', generation: latest.generation, orgId: identity.orgId, token: identity.token, userId: identity.userId } satisfies Grant }
      })
      combined.throwIfAborted()
      if (outcome.denied) {
        this.invalidate()
        this.publish()
        return this.stateWithoutRestoring()
      }
      await this.activate(stored.generation, verified, combined)
      return this.stateWithoutRestoring()
    } finally { this.restoring = false; this.restoreController = undefined }
  }

  /**
   * Host-only capability, cancelled by identity changes and validated again before returning.
   * @param run - Host operation; must honor its session signal and keep the token private.
   * @param signal - optional caller cancellation, combined with identity and plugin lifetimes.
   * @returns the operation result only while its authenticated generation remains current.
   * @throws IdentityError when signed out, expired, revoked or unable to verify a saved grant.
   */
  async withSession<T>(run: (session: IdentitySession) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.track((async () => {
      this.lifetime.signal.throwIfAborted()
      signal?.throwIfAborted()
      await this.observe(true)
      if (this.active === undefined && this.attempt === undefined) await this.restoreSession(signal)
      const active = this.active
      if (active === undefined) throw new IdentityError('UNAUTHORIZED', 'Sign in to an enterprise organization first')
      const combined = AbortSignal.any([active.controller.signal, this.lifetime.signal, ...(signal === undefined ? [] : [signal])])
      combined.throwIfAborted()
      const result = await run({
        orgId: active.value.orgId, userId: active.value.userId, generation: active.generation, token: active.value.token, signal: combined,
      })
      await this.observe(true)
      combined.throwIfAborted()
      return result
    })())
  }

  private async verify(identity: VerifiedIdentity, signal: AbortSignal): Promise<VerifiedIdentity> {
    const response = await request(this.options, '/api/auth/refresh', {}, signal, identity.token)
    if (response.status !== 200) throw new IdentityError(response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : 'HTTP', 'Enterprise session could not be verified', response.status)
    const verified = parseIdentity(response.body, identity.orgId, Date.now())
    if (verified.userId !== identity.userId) throw new IdentityError('PROTOCOL', 'Issuer changed the enterprise user during verification')
    return verified
  }
  private async commit(attempt: Attempt, identity: VerifiedIdentity, signal: AbortSignal): Promise<void> {
    await this.check(attempt, signal)
    await this.persist(attempt.generation, identity, signal)
    if (this.attempt === attempt) this.retireAttempt()
  }
  private async persist(expected: string, identity: VerifiedIdentity, signal: AbortSignal): Promise<void> {
    await this.ctx.credentials.modifyRecord(key, (current) => {
      signal.throwIfAborted()
      const stored = grant(current)
      if (stored?.generation !== expected) throw new IdentityError('STALE', 'Enterprise identity changed during sign-in')
      return Promise.resolve<CredentialRecord>({ kind: 'grant', payload: {
        version: 1, state: 'session', generation: expected, orgId: identity.orgId, token: identity.token, userId: identity.userId,
      } satisfies Grant })
    })
    await this.activate(expected, identity, signal)
  }
  private async activate(expected: string, identity: VerifiedIdentity, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const latest = grant(await this.ctx.credentials.readRecord(key))
    if (latest?.state !== 'session' || latest.generation !== expected || latest.token !== identity.token) throw new IdentityError('STALE', 'Enterprise identity changed during sign-in')
    if (identity.expiresAt <= Date.now()) throw new IdentityError('EXPIRED', 'Enterprise session has expired')
    this.active?.controller.abort(new IdentityError('STALE', 'Enterprise identity changed'))
    this.active = { value: identity, generation: brandString<IdentityGeneration>(expected), controller: new AbortController() }
    this.publish()
  }
  private async check(attempt: Attempt, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.attempt !== attempt || grant(await this.ctx.credentials.readRecord(key))?.generation !== attempt.generation) throw new IdentityError('STALE', 'Enterprise sign-in is no longer current')
    signal.throwIfAborted()
    if (Date.now() >= attempt.view.expiresAt) {
      this.nativeFailure = { id: attempt.view.id, orgId: attempt.org.orgId, reason: 'expired' }
      this.retireAttempt()
      this.publish()
      throw new IdentityError('EXPIRED', 'Enterprise sign-in has expired')
    }
    signal.throwIfAborted()
  }
  private requireAttempt(id: string): Attempt {
    if (this.attempt === undefined || this.attempt.view.id !== id) throw new IdentityError('STALE', 'Enterprise sign-in is no longer current')
    return this.attempt
  }
  private signal(attempt: Attempt, signal?: AbortSignal): AbortSignal {
    return AbortSignal.any([attempt.controller.signal, this.lifetime.signal, ...(signal === undefined ? [] : [signal])])
  }
  private async observe(fresh = false): Promise<void> {
    const active = this.active
    if (active === undefined) return
    try {
      const record = fresh
        ? await this.ctx.credentials.modifyRecord(key, () => Promise.resolve(undefined))
        : await this.ctx.credentials.readRecord(key)
      const stored = grant(record)
      if (this.active === active && (stored?.state !== 'session' || stored.generation !== active.generation || stored.token !== active.value.token || active.value.expiresAt <= Date.now())) { this.invalidate(); this.publish() }
    } catch (error) {
      if (this.active === active) { this.invalidate(); this.publish() }
      throw error
    }
  }
  private retireAttempt(): void {
    this.attempt?.controller.abort(new IdentityError('STALE', 'Enterprise sign-in closed'))
    this.attempt = undefined
  }
  private invalidate(): void {
    this.restoreController?.abort(new IdentityError('STALE', 'Enterprise identity changed'))
    this.retireAttempt()
    this.active?.controller.abort(new IdentityError('STALE', 'Enterprise identity changed'))
    this.active = undefined
  }
  private stateWithoutRestoring(): IdentityState {
    const active = this.active
    return active === undefined ? { status: 'signed-out' } : { status: 'authenticated', orgId: active.value.orgId, userId: active.value.userId, name: active.value.name, expiresAt: active.value.expiresAt, generation: active.generation }
  }
  private nativeState(): NativeAuthorizationState {
    return {
      status: this.active !== undefined ? 'signed-in' : this.attempt !== undefined ? 'pending' : 'signed-out',
      choices: this.listOrganizations().organizations.map(org => ({ id: org.orgId, label: org.label })),
      selectedChoiceId: this.active?.value.orgId ?? this.attempt?.org.orgId ?? this.nativeFailure?.orgId ?? this.options.defaultOrgId,
      ...(this.nativeFailure === undefined ? {} : { error: this.nativeFailure.reason }),
      ...(this.attempt === undefined ? {} : { attempt: {
        id: brandString<NativeAuthorizationAttemptId>(this.attempt.view.id), expiresAt: this.attempt.view.expiresAt,
      } }),
    }
  }
  private state(): IdentityState { return this.restoring ? { status: 'restoring' } : this.stateWithoutRestoring() }
  private publish(): void {
    const notices = [
      ['uwork-identity/changed', this.stateWithoutRestoring()],
      ['native-authorization/changed', this.nativeState()],
    ] as const
    for (const [event, state] of notices) {
      const listeners = this.ctx.events.dispatch('emit', [event, state]) as Array<(state: IdentityState | NativeAuthorizationState) => unknown>
      for (const listener of listeners) {
        try {
          void Promise.resolve(listener(state)).catch(() => { this.ctx.logger.warn('Enterprise identity state listener failed') })
        } catch { this.ctx.logger.warn('Enterprise identity state listener failed') }
      }
    }
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise))
    return promise
  }
}
