/** Sandboxed safe authorization API; callback interception stays in Main. */
import { contextBridge, ipcRenderer } from 'electron'
import { NATIVE_AUTHORIZATION_IPC, type NativeAuthorizationApi } from './native-authorization-api.ts'

/** Expose only renderer-safe native login operations in this owned document. */
export function exposeNativeAuthorization(): void {
  const api: NativeAuthorizationApi = {
    state: () => ipcRenderer.invoke(NATIVE_AUTHORIZATION_IPC.state),
    start: (choiceId, bounds) => ipcRenderer.invoke(NATIVE_AUTHORIZATION_IPC.start, choiceId, bounds),
    cancel: id => ipcRenderer.invoke(NATIVE_AUTHORIZATION_IPC.cancel, id),
    poll: id => ipcRenderer.invoke(NATIVE_AUTHORIZATION_IPC.poll, id),
  }
  contextBridge.exposeInMainWorld('dshNativeAuthorization', api)
}
