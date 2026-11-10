import type { Branded } from '@deepseek-ai/dsh-brand'

/** Organization admitted by the deployment allowlist. */
export type OrganizationId = Branded<'UWorkOrganizationId'>
/** Persisted identity ownership generation, changed by login switch or logout. */
export type IdentityGeneration = Branded<'UWorkIdentityGeneration'>
/** Issuer handoff ID or locally generated callback nonce. */
export type SignInAttemptId = Branded<'UWorkSignInAttemptId'>

/** Public configuration recovered from the issuer's supported release. No secrets. */
export interface Organization {
  /** Exact issuer organization ID. */
  orgId: string
  /** Public WeCom corporation ID for this organization. */
  corpId: string
  /** Public numeric WeCom application ID. */
  agentId: string
  /** Optional public display name; omitted uses the organization ID. */
  label?: string | undefined
  /** Exact HTTPS callback URL, without credentials, query or fragment. */
  callbackUrl: string
}

/** Safe renderer projection; stored credentials alone never imply authentication. */
export type IdentityState = { status: 'signed-out' | 'restoring' } | {
  status: 'authenticated'
  orgId: OrganizationId
  userId: string
  name: string
  expiresAt: number
  generation: IdentityGeneration
}

/** Main-only descriptor: do not publish this through renderer Remote services. */
export interface NativeSignInAttempt {
  id: SignInAttemptId
  authorizationUrl: string
  callbackUrl: string
  allowedNavigationOrigins: string[]
  expiresAt: number
}

/** Host-only capability, scoped to the current authenticated generation. */
export interface IdentitySession {
  orgId: OrganizationId
  userId: string
  generation: IdentityGeneration
  token: string
  signal: AbortSignal
}
