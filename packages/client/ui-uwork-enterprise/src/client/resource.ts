/** Safe account and model observations published through native Client resources. */
import { RemoteError, type RemoteResult, type TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { IdentityState } from '@deepseek-ai/dsh-uwork-enterprise/types'
import type { ModelProvisioningState } from '@deepseek-ai/dsh-uwork-model-provisioning/types'
export type {} from '@deepseek-ai/dsh-uwork-enterprise/remote'
export type {} from '@deepseek-ai/dsh-uwork-model-provisioning/remote'
import { enterpriseOwner } from './store.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'uwork-enterprise/disconnected': Record<string, never>
    'uwork-enterprise/unavailable': Record<string, never>
    'uwork-enterprise/models-unavailable': Record<string, never>
  }
}

/** Safe account identity and deployment-owned organization labels. */
export interface EnterpriseData {
  readonly identity: IdentityState
  readonly organizations: Array<{ orgId: string; label: string }>
}
/** Canonical account resource address before connection and refresh parameters. */
export const ACCOUNT_ADDRESS = 'dsh-resource://uwork-enterprise/account'
/** Canonical managed-model resource address before identity and interaction parameters. */
export const MODEL_ADDRESS = 'dsh-resource://uwork-enterprise-models/models'
function isAborted(signal: AbortSignal): boolean { return signal.aborted }

/** Apply-world authority and completed-action proof for a model read. */
export interface ModelReadProof {
  readonly owner: string
  readonly completedCreation: number
  readonly readIdentity: TypertClientRemote['uworkIdentity']['getState']
  readonly connection: () => number | undefined
  readonly settled: (owner: string, completedCreation: number) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'uwork-enterprise': EnterpriseData
    'uwork-enterprise-models': ModelProvisioningState
  }
}

/** One account holder watches authoritative safe identity frames until release.
 * @param remote - Generated safe identity methods.
 * @param signal - Resource holder lifetime.
 * @param connected - Whether this address belongs to a ready connection generation.
 * @returns Safe identity and public organization frames or classified failures.
 */
export async function* openAccount(remote: TypertClientRemote['uworkIdentity'], signal: AbortSignal, connected = true): AsyncIterable<RemoteResult<EnterpriseData>> {
  if (!connected) {
    yield { ok: false, error: new RemoteError('uwork-enterprise/disconnected', 'Account connection is unavailable', {}) }
    return
  }
  try {
    const organizations = await remote.listOrganizations()
    if (signal.aborted) return
    if (!organizations.ok) { yield { ok: false, error: organizations.error }; return }
    for await (const identity of remote.watchState(signal)) {
      if (isAborted(signal)) return
      yield { ok: true, value: { identity, organizations: organizations.value.organizations } }
    }
  } catch {
    if (!signal.aborted) yield { ok: false, error: new RemoteError('uwork-enterprise/unavailable', 'Account connection is unavailable', {}) }
  }
}

/** Automatic model reads may refresh existing capabilities and keys, never create one.
 * @param remote - Generated safe model methods.
 * @param authenticated - Whether this resource belongs to the current verified account.
 * @param signal - Resource holder lifetime.
 * @param proof - Current connection/account authority and post-completion interaction token.
 * @returns Safe model observations without key values.
 */
export async function* openModels(
  remote: TypertClientRemote['uworkModelProvisioning'], authenticated: boolean, signal: AbortSignal, proof: ModelReadProof,
): AsyncIterable<RemoteResult<ModelProvisioningState>> {
  if (!authenticated) { yield { ok: true, value: { status: 'signed-out' } }; return }
  try {
    const result = await remote.refresh(signal)
    if (isAborted(signal)) return
    if (result.ok) {
      const identity = await proof.readIdentity()
      if (isAborted(signal)) return
      if (!identity.ok || identity.value.status !== 'authenticated' || proof.owner !== enterpriseOwner(proof.connection(), identity.value)) {
        yield { ok: false, error: new RemoteError('uwork-enterprise/models-unavailable', 'Model authority changed', {}) }
        return
      }
      if (result.value.status === 'ready' || result.value.status === 'capabilities-required') {
        proof.settled(proof.owner, proof.completedCreation)
      }
    }
    yield result
  } catch {
    if (!signal.aborted) yield { ok: false, error: new RemoteError('uwork-enterprise/models-unavailable', 'Model state is unavailable', {}) }
  }
}
