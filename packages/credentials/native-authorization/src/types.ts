/** Token-free native entry projections and Main-only authorization navigation. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Provider-owned authorization generation, never a credential. */
export type NativeAuthorizationAttemptId = Branded<'NativeAuthorizationAttemptId'>
/** Provider-owned selectable organization or login method. */
export interface NativeAuthorizationChoice { readonly id: string; readonly label: string }
/** Renderer-safe login status. */
export interface NativeAuthorizationState {
  readonly status: 'signed-out' | 'pending' | 'signed-in'
  readonly choices: readonly NativeAuthorizationChoice[]
  readonly selectedChoiceId?: string
  readonly attempt?: { readonly id: NativeAuthorizationAttemptId; readonly expiresAt: number }
  readonly error?: 'expired' | 'failed'
}
/** Private attempt navigation, transferred only over Host/Main IPC. */
export interface NativeAuthorizationAttempt {
  readonly id: NativeAuthorizationAttemptId
  readonly authorizationUrl: string
  readonly callbackUrl: string
  readonly allowedNavigationOrigins: readonly string[]
  readonly expiresAt: number
}
/** Product provider owns verification, credential storage and strict late-result cancellation. */
export interface NativeAuthorizationProvider {
  /**
   * @returns safe state without tokens, codes or authorization URLs.
   */
  getState(this: void): Promise<NativeAuthorizationState>
  /**
   * @param choiceId - selected provider choice.
   * @param signal - withdrawn with the owning native request.
   * @returns Main-only navigation.
   */
  start(this: void, choiceId: string, signal: AbortSignal): Promise<NativeAuthorizationAttempt>
  /**
   * @param id - owned attempt.
   * @param url - callback intercepted by Main.
   * @param signal - native operation lifetime.
   * @returns verified safe state.
   */
  complete(this: void, id: NativeAuthorizationAttemptId, url: string, signal: AbortSignal): Promise<NativeAuthorizationState>
  /**
   * @param id - owned attempt.
   * @param signal - native operation lifetime.
   * @returns handoff progress or verified safe state.
   */
  poll(this: void, id: NativeAuthorizationAttemptId, signal: AbortSignal): Promise<NativeAuthorizationState>
  /**
   * @param id - attempt being withdrawn.
   * @returns state after cancellation and owned work have settled.
   */
  cancel(this: void, id: NativeAuthorizationAttemptId): Promise<NativeAuthorizationState>
}
