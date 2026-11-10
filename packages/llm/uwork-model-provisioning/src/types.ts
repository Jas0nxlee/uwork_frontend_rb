/** Safe account snapshot attached to an explicit key-creation confirmation. */
export interface ModelIdentityBinding {
  /** Organization shown when the user confirmed the action. */
  readonly orgId: string
  /** User shown when the action was confirmed. */
  readonly userId: string
  /** Verified identity generation shown by the confirmation. */
  readonly generation: string
}
/** Completed provisioning or a safe user-action requirement. */
export type SyncResult = { status: 'ready'; provider: string; modelIds: string[]; needsModelSelection: boolean }
  | { status: 'key-required' | 'capabilities-required' | 'key-outcome-unknown' }
/** Safe current Host provisioning observation with classified failure only. */
export type ModelProvisioningState = SyncResult | { status: 'idle' | 'signed-out' | 'syncing' }
  | { status: 'error'; reason: 'identity' | 'gateway' | 'storage' | 'unavailable' }
