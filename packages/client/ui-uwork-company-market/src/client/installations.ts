/** Root-owned installation actions with explicit uncertain-outcome reporting. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertClientRemote, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CompanyInstallations } from '@deepseek-ai/dsh-uwork-company-market/installation-types'
export type {} from '@deepseek-ai/dsh-uwork-company-market/remote'

/** Last trusted installation list and the current management operation. */
export interface InstallationState {
  /** Last successful list; null before the first read. */
  readonly value: CompanyInstallations | null
  /** Whether the installation list is being refreshed. */
  readonly loading: boolean
  /** Slug of the active write operation, or null. */
  readonly pending: string | null
  /** Localized failure key; unknown results require a fresh list before retrying. */
  readonly failure: 'installationRead' | 'installationRejected' | 'installationUnchanged' | 'installationCommitted' | 'installationUnknown' | null
}

/** Installation state and actions owned by the market tab's root. */
export class InstallationController {
  /** Authoritative list snapshots and current operation feedback. */
  readonly store = createSnapshotStore<InstallationState>({ value: null, loading: false, pending: null, failure: null })
  private readonly lifetime = new AbortController()
  private read: AbortController | undefined
  private started = false

  constructor(private readonly remote: TypertClientRemote['uworkCompanyMarket']) {}

  /** Read the initial installation list once per root. */
  start(): void {
    if (this.started) return
    this.started = true
    this.refresh()
  }

  /** Refresh saved state, clearing prior operation feedback only after a successful read. */
  refresh(): void { void this.readList(false) }

  /**
   * Install an exact version, then reconcile saved state even when the result is uncertain.
   * @param slug - selected catalog skill.
   * @param version - exact catalog version.
   */
  install(slug: string, version: string): void {
    this.mutate(slug, () => this.remote.installSkill(slug, version, this.lifetime.signal))
  }

  /**
   * Enable or disable an installed company skill.
   * @param slug - company-owned installed slug.
   * @param enabled - next discovery state.
   */
  setEnabled(slug: string, enabled: boolean): void {
    this.mutate(slug, () => this.remote.setEnabled(slug, enabled, this.lifetime.signal))
  }

  /**
   * Remove an installed company skill and reconcile the saved list.
   * @param slug - company-owned installed slug.
   */
  uninstall(slug: string): void {
    this.mutate(slug, () => this.remote.uninstallSkill(slug, this.lifetime.signal))
  }

  private async readList(preserveFailure: boolean): Promise<void> {
    if (this.lifetime.signal.aborted) return
    this.read?.abort()
    const controller = new AbortController()
    this.read = controller
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    this.store.set({ ...this.store.getSnapshot(), loading: true })
    try {
      const result = await this.remote.installations(signal)
      if (signal.aborted) return
      const current = this.store.getSnapshot()
      this.store.set(result.ok
        ? { ...current, value: result.value, loading: false, failure: preserveFailure ? current.failure : null }
        : { ...current, loading: false, failure: 'installationRead' })
    } catch (error) {
      void error // Transport rejection is rendered without exposing raw diagnostics.
      if (!signal.aborted) this.store.set({ ...this.store.getSnapshot(), loading: false, failure: 'installationRead' })
    }
  }

  private mutate(slug: string, action: () => Promise<RemoteResult<unknown>>): void {
    const state = this.store.getSnapshot()
    if (this.lifetime.signal.aborted || state.pending !== null || state.loading || state.value?.available !== true || state.failure === 'installationRead') return
    this.store.set({ ...state, pending: slug, failure: null })
    void (async () => {
      let failure: InstallationState['failure'] = null
      try {
        const result = await action()
        if (!result.ok) {
          failure = 'installationRejected'
          if (result.error.code === 'uwork-company-market/install-failed') {
            const details = result.error.details
            failure = details.outcome === 'unchanged' ? 'installationUnchanged' : details.outcome === 'committed' ? 'installationCommitted' : 'installationUnknown'
          }
        }
      } catch (error) {
        void error // A lost acknowledgement may follow a successful activation.
        failure = 'installationUnknown'
      }
      if (this.lifetime.signal.aborted) return
      this.store.set({ ...this.store.getSnapshot(), failure })
      await this.readList(true)
      this.settled()
    })()
  }

  private settled(): void {
    if (!this.lifetime.signal.aborted) this.store.set({ ...this.store.getSnapshot(), pending: null })
  }

  /** Cancel owned reads and writes when the root contribution disappears. */
  dispose(): void { this.lifetime.abort(); this.read?.abort() }
}
