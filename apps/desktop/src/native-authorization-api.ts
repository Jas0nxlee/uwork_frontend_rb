/** Safe renderer operations for a product-selected native authorization provider. */
import type { NativeAuthorizationState, NativeAuthorizationAttemptId } from '@deepseek-ai/dsh-native-authorization/types'

/** Renderer IPC never accepts a callback URL or returns browser navigation or credentials. */
export const NATIVE_AUTHORIZATION_IPC = {
  state: 'dsh-native-authorization:state', start: 'dsh-native-authorization:start',
  cancel: 'dsh-native-authorization:cancel', poll: 'dsh-native-authorization:poll',
} as const
/** Shared by standalone Welcome and the application account settings. */
export interface NativeAuthorizationApi {
  /**
   * @returns safe state after terminal-state browser cleanup, or null for the standard account Welcome.
   */
  state(this: void): Promise<NativeAuthorizationState | null>
  /**
   * @param choiceId - selected organization or method.
   * @param bounds - validated browser placeholder.
   * @returns safe progress.
   */
  start(this: void, choiceId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<NativeAuthorizationState>
  /**
   * @param id - attempt currently displayed.
   * @returns settled safe status.
   */
  cancel(this: void, id: NativeAuthorizationAttemptId): Promise<NativeAuthorizationState>
  /**
   * @param id - attempt currently displayed.
   * @returns handoff progress or safe verified status.
   */
  poll(this: void, id: NativeAuthorizationAttemptId): Promise<NativeAuthorizationState>
}
