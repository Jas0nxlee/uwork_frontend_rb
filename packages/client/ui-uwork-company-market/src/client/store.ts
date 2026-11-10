/** Root-owned company catalog state, with cancellation and obsolete-result suppression. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompanyMarketPage } from '@deepseek-ai/dsh-uwork-company-market/types'
export type {} from '@deepseek-ai/dsh-uwork-company-market/remote'

/** Localized failure category; diagnostics and response bodies are not rendered. */
export type Failure = 'network' | 'invalid' | 'limit' | 'auth' | 'rate' | 'query'

/** Last requested query and its current or retained result. */
export type MarketState = {
  readonly text: string
  readonly page: number
} & (
  | { readonly status: 'idle'; readonly value: null }
  | { readonly status: 'loading'; readonly value: CompanyMarketPage | null }
  | { readonly status: 'ready'; readonly value: CompanyMarketPage }
  | { readonly status: 'error'; readonly value: CompanyMarketPage | null; readonly failure: Failure }
)

/** Narrow state and actions injected into the company market tab. */
export interface MarketFace {
  readonly hooks: { readonly market: HostObservable<MarketState> }
  /** Read the catalog when the tab first mounts; subsequent mounts retain the current query. */
  readonly start: () => void
  /** Replace the query or retry a requested result page. */
  readonly load: (text: string, page: number) => void
}

/** One root's company market query and request lifetime. */
export class MarketController {
  /** Requested query and last successful catalog page. */
  readonly store = createSnapshotStore<MarketState>({ status: 'idle', text: '', page: 0, value: null })
  /** Stable state source and actions supplied to the slot renderer. */
  readonly face: MarketFace
  private request: AbortController | undefined
  private disposed = false

  constructor(private readonly market: TypertClientRemote['uworkCompanyMarket']) {
    this.face = {
      hooks: { market: this.store },
      start: () => { if (this.store.getSnapshot().status === 'idle') this.load('', 0) },
      load: (text, page) => { this.load(text, page) },
    }
  }

  private load(text: string, page: number): void {
    if (this.disposed) return
    this.request?.abort()
    const controller = new AbortController()
    this.request = controller
    this.store.set({ status: 'loading', text, page, value: this.store.getSnapshot().value })
    const commit = (state: MarketState) => {
      if (!controller.signal.aborted) this.store.set(state)
    }
    void this.market.search(text, page, controller.signal).then((result) => {
      if (result.ok) { commit({ status: 'ready', text, page, value: result.value }); return }
      const error = result.error
      let failure: Failure = 'network'
      if (error.code === 'uwork-company-market/invalid-query') failure = 'query'
      if (error.code === 'uwork-company-market/unavailable') {
        const reason = error.details.reason
        failure = reason === 'unauthorized' || reason === 'forbidden' ? 'auth'
          : reason === 'rate-limited' ? 'rate' : reason === 'invalid' ? 'invalid' : reason === 'limit' ? 'limit' : 'network'
      }
      commit({ status: 'error', text, page, failure, value: this.store.getSnapshot().value })
    }, (_error: unknown) => {
      // A disconnected or unmounted Remote can reject before producing a method result.
      commit({ status: 'error', text, page, failure: 'network', value: this.store.getSnapshot().value })
    })
  }

  /** Abort the owned invocation before the root contribution disappears. */
  dispose(): void {
    this.disposed = true
    this.request?.abort()
  }
}
