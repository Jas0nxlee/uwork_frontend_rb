/** Mutation-only interaction state; account and model reads belong to resources. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
export type {} from '@deepseek-ai/dsh-uwork-enterprise/remote'
export type {} from '@deepseek-ai/dsh-uwork-model-provisioning/remote'

/** Mutation interaction facts scoped to one connection and verified account. */
export interface MutationState {
  readonly owner: string | null
  readonly signingOut: boolean
  readonly signOutFailed: boolean
  readonly creating: boolean
  readonly createUnknown: boolean
  readonly completedCreation: number
}
/** Framework-bound mutation state and actions supplied to the settings page. */
export interface EnterpriseFace {
  readonly hooks: {
    readonly mutations: HostObservable<MutationState>
    readonly enterpriseConnection: HostObservable<ConnectionGeneration | undefined>
  }
  readonly signOut: (owner: string) => Promise<void>
  readonly enterOwner: (owner: string) => void
  readonly createManagedKey: (owner: string, expected: ManagedKeyBinding) => Promise<void>
}

/** Safe confirmation snapshot derived from the generated server action. */
export type ManagedKeyBinding = Parameters<TypertClientRemote['uworkModelProvisioning']['createManagedKey']>[0]

/** Identify a mutation's UI authority without carrying credentials.
 * @param connection - Native Client connection generation.
 * @param binding - Verified identity, or null before authentication.
 * @returns Unambiguous interaction-owner key.
 */
export function enterpriseOwner(connection: number | undefined, binding: ManagedKeyBinding | null): string {
  return JSON.stringify([connection, binding?.orgId, binding?.userId, binding?.generation ?? ''])
}

/** Stable neutral interaction snapshot used outside its owning account. */
export const EMPTY_MUTATIONS: MutationState = {
  owner: null, signingOut: false, signOutFailed: false, creating: false, createUnknown: false, completedCreation: 0,
}

/** No credential, account projection, model catalog, fetch cache or polling lives here. */
export class EnterpriseMutations {
  /** Current mutation interaction facts; never a read cache. */
  readonly store = createSnapshotStore<MutationState>(EMPTY_MUTATIONS)
  private disposed = false
  private creation: AbortController | undefined
  private logout: object | undefined
  private creationSerial = 0
  constructor(
    private readonly identity: Pick<TypertClientRemote['uworkIdentity'], 'signOut'>,
    private readonly models: Pick<TypertClientRemote['uworkModelProvisioning'], 'createManagedKey'>,
  ) {}

  /** Cancel a previous owner's UI work without inheriting its outcome into the new owner.
   * @param owner - Connection and identity receiving the visible controls.
   */
  enterOwner(owner: string): void {
    if (this.disposed) return
    const state = this.store.getSnapshot()
    if (state.owner === owner) return
    this.creation?.abort()
    this.creation = undefined
    this.logout = undefined
    if (state.creating || state.signingOut) {
      this.store.set({ ...state, creating: false, createUnknown: state.createUnknown || state.creating,
        completedCreation: state.creating ? this.creationSerial : state.completedCreation,
        signingOut: false, signOutFailed: state.signOutFailed || state.signingOut })
    }
  }

  /** Settle uncertainty only after an authoritative read of the post-completion resource.
   * @param owner - Interaction owner that opened the read.
   * @param completedCreation - Completed attempt encoded in that resource address.
   */
  acceptModelRead(owner: string, completedCreation: number): void {
    const state = this.store.getSnapshot()
    if (this.disposed || state.owner !== owner || state.creating || !state.createUnknown
      || completedCreation === 0 || state.completedCreation !== completedCreation) return
    this.store.set({ ...state, createUnknown: false })
  }

  /** Revoke identity through the Host without claiming an uncertain response succeeded.
   * @param owner - Connection and identity issuing the gesture.
   * @returns After the safe mutation response or classified transport failure.
   */
  async signOut(owner: string): Promise<void> {
    const state = this.store.getSnapshot().owner === owner ? this.store.getSnapshot() : EMPTY_MUTATIONS
    if (this.disposed || state.signingOut) return
    const operation = {}
    this.logout = operation
    this.store.set({ ...state, owner, signingOut: true, signOutFailed: false })
    let failed: boolean
    try { failed = !(await this.identity.signOut()).ok } catch { failed = true }
    if (!this.isDisposed() && this.logout === operation && this.store.getSnapshot().owner === owner) {
      this.store.set({ ...this.store.getSnapshot(), signingOut: false, signOutFailed: failed })
    }
  }

  /** Called only after an explicit confirmation; an uncertain POST never retries implicitly.
   * @param owner - UI authority captured by the confirmation.
   * @param expected - Complete safe identity snapshot checked by the Host before mutation.
   * @returns After the confirmed operation settles, without exposing a key value.
   */
  async createManagedKey(owner: string, expected: ManagedKeyBinding): Promise<void> {
    const state = this.store.getSnapshot().owner === owner ? this.store.getSnapshot() : EMPTY_MUTATIONS
    if (this.disposed || state.creating || state.createUnknown) return
    const request = new AbortController()
    const attempt = ++this.creationSerial
    this.creation?.abort()
    this.creation = request
    this.store.set({ ...state, owner, creating: true })
    let unknown: boolean
    try {
      const result = await this.models.createManagedKey(expected, request.signal)
      unknown = !result.ok || result.value.status === 'key-outcome-unknown'
    } catch { unknown = true }
    if (!this.isDisposed() && this.creation === request && this.store.getSnapshot().owner === owner) {
      this.store.set({ ...this.store.getSnapshot(), creating: false, createUnknown: unknown, completedCreation: attempt })
    }
  }

  /** End mutation publication and cancel a pending creation request. */
  dispose(): void { this.disposed = true; this.creation?.abort() }
  private isDisposed(): boolean { return this.disposed }
}
