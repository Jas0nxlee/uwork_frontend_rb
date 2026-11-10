/** Native-only authorization selection; product composition installs exactly one provider. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { NativeAuthorizationProvider, NativeAuthorizationState } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { nativeAuthorization: NativeAuthorization }
  interface Events {
    /**
     * A product identity provider has committed a renderer-safe authorization state.
     * @mode emit
     * @param state - token-free organization choices, attempt progress and session status.
     */
    'native-authorization/changed'(state: NativeAuthorizationState): void
  }
}

/** Registry read only by the private Desktop Host bridge, never exposed through Remote. */
export default class NativeAuthorization extends Service {
  private provider: NativeAuthorizationProvider | undefined
  constructor(ctx: Context) { super(ctx, 'nativeAuthorization') }

  /**
   * Select one provider for this registration lifetime.
   * @param provider - product-selected authentication owner.
   * @returns lifetime disposer; a second provider is rejected.
   */
  register(provider: NativeAuthorizationProvider): () => void {
    if (this.provider !== undefined) throw new Error('Native authorization provider already registered')
    const dispose = this.ctx.effect(() => {
      this.provider = provider
      return () => { this.provider = undefined }
    })
    return () => { void dispose() }
  }

  /**
   * Read the provider selected by product composition.
   * @returns selected private provider, or undefined for the standard account Welcome.
   */
  getProvider(): NativeAuthorizationProvider | undefined { return this.provider }
}
