/** Strict issuer/configuration boundaries. Secrets never escape this Host module. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OrganizationId } from './types.ts'
import { IdentityError } from './errors.ts'

const text = z.string().trim().min(1).max(256)
const httpsUrl = z.string().max(2048).transform((value, ctx) => {
  let url: URL
  try { url = new URL(value) } catch { ctx.addIssue({ code: 'custom', message: 'HTTPS URL required' }); return z.NEVER }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    ctx.addIssue({ code: 'custom', message: 'HTTPS URL without credentials, query or fragment required' }); return z.NEVER
  }
  return url.href
})
const organization = z.object({
  orgId: text,
  corpId: z.string().regex(/^[a-zA-Z0-9_-]{3,128}$/),
  agentId: z.string().regex(/^\d{1,20}$/),
  label: z.string().trim().min(1).max(64).optional(),
  callbackUrl: httpsUrl,
}).strict()

/** Strict deployment schema; callback URLs and issuer origin are trusted only after validation. */
const configuration = z.object({
  apiBaseUrl: httpsUrl.refine(value => new URL(value).pathname === '/', 'API origin required'),
  organizations: z.array(organization).min(1).max(128),
  defaultOrgId: text,
  requestTimeoutMs: z.number().int().min(1).max(120000).default(15000),
  attemptTimeoutMs: z.number().int().min(1).max(3600000).default(300000),
  pollIntervalMs: z.number().int().min(1).max(60000).default(1500),
  observationIntervalMs: z.number().int().min(1).max(60000).default(1000),
  maxResponseBytes: z.number().int().min(1).max(1048576).default(65536),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.organizations.map(org => org.orgId))
  if (ids.size !== value.organizations.length || !ids.has(value.defaultOrgId)) ctx.addIssue({ code: 'custom', message: 'Unique organizations and configured default required' })
})
/** Fully defaulted deployment options used by Host operations. */
export type Options = z.infer<typeof configuration>

/**
 * Validates the complete deployment allowlist and resource bounds.
 * @param input - untrusted plugin configuration.
 * @returns validated allowlists and resource bounds.
 * @throws IdentityError when configuration is malformed.
 */
export function parseConfiguration(input: unknown): Options {
  const result = configuration.safeParse(input)
  if (!result.success) throw new IdentityError('CONFIG', 'Invalid enterprise identity configuration')
  return result.data
}

const userSchema = z.object({
  id: z.union([text, z.number().int().nonnegative().transform(String)]),
  org_id: text,
  name: text,
}).loose()
const authSchema = z.object({ token: z.string().min(1).max(16384), user: userSchema, needsEmailAuth: z.boolean().optional() }).loose()
const expirySchema = z.object({ exp: z.number().int().positive() }).loose()
/** Host-only identity verified structurally; caller owns server verification. */
export interface VerifiedIdentity { token: string; orgId: OrganizationId; userId: string; name: string; expiresAt: number }

/**
 * JWT expiry schedules requests only; caller must verify with the issuer before publishing restored state.
 * @param input - untrusted issuer authentication response.
 * @param orgId - expected configured organization.
 * @param now - current Unix time in milliseconds.
 * @returns bounded identity and token for Host verification.
 * @throws IdentityError for invalid, wrong-organization or expired responses.
 */
export function parseIdentity(input: unknown, orgId: string, now: number): VerifiedIdentity {
  const result = authSchema.safeParse(input)
  if (!result.success || result.data.user.org_id !== orgId) throw new IdentityError('PROTOCOL', 'Issuer returned an invalid enterprise identity')
  const value = result.data
  let claims: unknown
  try {
    const parts = value.token.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('JWT required')
    claims = JSON.parse(Buffer.from(value.token.slice(value.token.indexOf('.') + 1, value.token.lastIndexOf('.')), 'base64url').toString('utf8'))
  } catch { throw new IdentityError('PROTOCOL', 'Issuer returned an invalid enterprise token') }
  const expiry = expirySchema.safeParse(claims)
  const expiresAt = expiry.success ? expiry.data.exp * 1000 : 0
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new IdentityError('EXPIRED', 'Enterprise session has expired')
  return { token: value.token, orgId: brandString<OrganizationId>(orgId), userId: value.user.id, name: value.user.name, expiresAt }
}

const handoffSchema = z.object({
  handoff_id: text,
  handoff_secret: z.string().min(1).max(16384),
  expires_at: z.union([z.iso.datetime({ offset: true }), z.number().positive()]),
}).loose()
/**
 * Validates a handoff and clamps its lifetime to the local attempt deadline.
 * @param input - untrusted HTTP 201 handoff response.
 * @param now - current Unix time in milliseconds.
 * @param maximum - local attempt deadline in milliseconds.
 * @returns Host-only handoff secret and clamped expiry.
 * @throws IdentityError for invalid or expired handoffs.
 */
export function parseHandoff(input: unknown, now: number, maximum: number): { id: string; secret: string; expiresAt: number } {
  const parsed = handoffSchema.safeParse(input)
  if (!parsed.success) throw new IdentityError('PROTOCOL', 'Issuer returned an invalid sign-in handoff')
  const value = parsed.data
  const expiry = typeof value.expires_at === 'number' ? (value.expires_at < 1e12 ? value.expires_at * 1000 : value.expires_at) : Date.parse(value.expires_at)
  if (!Number.isSafeInteger(expiry) || expiry <= now) throw new IdentityError('EXPIRED', 'Enterprise sign-in handoff has expired')
  return { id: value.handoff_id, secret: value.handoff_secret, expiresAt: Math.min(expiry, maximum) }
}

/**
 * Bounded JSON reads retain cancellation until the complete body has been consumed.
 * @param options - validated deployment and response bounds.
 * @param path - owner-selected issuer API path.
 * @param body - JSON request body; never included in diagnostics.
 * @param signal - operation cancellation, combined with the request deadline.
 * @param token - optional Host bearer token; absent sends no authorization header.
 * @returns status and parsed JSON for HTTP 200/201; other statuses have no body.
 * @throws IdentityError for network, malformed JSON or response-limit failures.
 */
export async function request(
  options: Options, path: string, body: unknown, signal: AbortSignal, token?: string,
): Promise<{ status: number; body: unknown }> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs)])
  let response: Response
  try {
    response = await fetch(new URL(path, options.apiBaseUrl), {
      method: 'POST', redirect: 'error', signal: requestSignal,
      headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    })
    if (response.status !== 200 && response.status !== 201) {
      await response.body?.cancel()
      return { status: response.status, body: undefined }
    }
    const reader = response.body?.getReader()
    if (reader === undefined) throw new IdentityError('PROTOCOL', 'Issuer returned an empty response')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > options.maxResponseBytes) throw new IdentityError('PROTOCOL', 'Issuer response exceeds its configured limit')
        chunks.push(part.value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    try { return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) } }
    catch { throw new IdentityError('PROTOCOL', 'Issuer returned invalid JSON') }
  } catch (error) {
    if (error instanceof IdentityError) throw error
    if (signal.aborted) throw signal.reason
    throw new IdentityError('NETWORK', 'Enterprise identity service could not be reached')
  }
}
