/** Private Host/Main bridge and exact-window renderer admission for native authorization. */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { NativeAuthorizationProvider, NativeAuthorizationAttemptId, NativeAuthorizationState } from '@deepseek-ai/dsh-native-authorization/types'
import { DesktopAuthorizationView, type AuthorizationOwner } from './authorization-view.ts'
import { NATIVE_AUTHORIZATION_IPC } from './native-authorization-api.ts'
import { platformBounds } from './platform-view.ts'

/** One Main-owned controller shares private Host operations across approved application windows. */
export class NativeAuthorizationController {
  private readonly owners = new Map<AuthorizationOwner, () => void>()
  private readonly surface = new DesktopAuthorizationView()
  private attempt: NativeAuthorizationAttemptId | undefined
  private readonly lifetime = new AbortController()
  private starting: AbortController | undefined
  private readonly tasks = new Set<Promise<unknown>>()

  /**
   * @param provider - private Host IPC facade, or undefined for the standard account product.
   * @param signedIn - workspace admission after verified login; receives no credentials.
   * @param blocked - shell admission policy; omitted when the embedding shell has no blocking overlay.
   */
  constructor(private readonly provider: NativeAuthorizationProvider | undefined,
    private readonly signedIn: () => Promise<void>, private readonly blocked: (owner: AuthorizationOwner) => boolean = () => false) {
    const admit = (event: IpcMainInvokeEvent): AuthorizationOwner => {
      for (const owner of this.owners.keys()) {
        if (!owner.isDestroyed() && event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame) return owner
      }
      throw new Error('Rejected native authorization sender')
    }
    const state = async (value: Promise<NativeAuthorizationState>): Promise<NativeAuthorizationState> => {
      const result = await value
      const id = this.attempt
      if (result.status !== 'pending') { this.attempt = undefined; await this.surface.closeAndWait() }
      if (result.status === 'signed-in' && id !== undefined) await this.signedIn()
      return result
    }
    ipcMain.handle(NATIVE_AUTHORIZATION_IPC.state, (event) => {
      admit(event)
      return provider === undefined ? null : state(provider.getState())
    })
    ipcMain.handle(NATIVE_AUTHORIZATION_IPC.start, (event, choice: unknown, bounds: unknown) => {
      const task = (async () => {
        const owner = admit(event)
        if (this.blocked(owner)) throw new Error('Native authorization blocked by shell policy')
        if (provider === undefined || typeof choice !== 'string' || choice.length === 0 || choice.length > 256) throw new Error('Invalid native authorization choice')
        const rectangle = platformBounds(bounds)
        await this.withdraw()
        this.starting?.abort()
        const start = new AbortController()
        this.starting = start
        const signal = AbortSignal.any([start.signal, this.lifetime.signal])
        const ownerContents = owner.webContents
        const abortStart = () => { start.abort() }
        const navigateStart = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean) => {
          if (mainFrame && !inPlace) abortStart()
        }
        owner.on('closed', abortStart)
        ownerContents.on('destroyed', abortStart)
        ownerContents.on('render-process-gone', abortStart)
        ownerContents.on('did-start-navigation', navigateStart)
        let attempt
        try { attempt = await provider.start(choice, signal) }
        finally {
          owner.removeListener('closed', abortStart)
          ownerContents.removeListener('destroyed', abortStart)
          ownerContents.removeListener('render-process-gone', abortStart)
          ownerContents.removeListener('did-start-navigation', navigateStart)
          if (this.starting === start) this.starting = undefined
        }
        if (signal.aborted || this.blocked(owner)) { await provider.cancel(attempt.id); throw new Error('Native authorization withdrawn') }
        this.attempt = attempt.id
        this.track(this.surface.open(owner, event, attempt, rectangle,
          async (url, signal) => {
            const result = await provider.complete(attempt.id, url, signal)
            // Completion runs inside the surface task; closing and awaiting itself would deadlock.
            if (result.status === 'signed-in' && this.attempt === attempt.id) {
              this.attempt = undefined; this.surface.close(); await this.signedIn()
            }
          }, () => {
            if (this.attempt === attempt.id) { this.attempt = undefined; this.track(provider.cancel(attempt.id)) }
          }).catch(async (_error: unknown) => {
          if (this.attempt === attempt.id) await this.withdraw()
        }))
        return provider.getState()
      })()
      this.track(task)
      return task
    })
    ipcMain.handle(NATIVE_AUTHORIZATION_IPC.poll, (event, id: unknown) => {
      admit(event)
      if (provider === undefined || typeof id !== 'string' || id !== this.attempt) throw new Error('Invalid native authorization attempt')
      return state(provider.poll(this.attempt, this.lifetime.signal))
    })
    ipcMain.handle(NATIVE_AUTHORIZATION_IPC.cancel, async (event, id: unknown) => {
      admit(event)
      if (provider === undefined || typeof id !== 'string' || id !== this.attempt) throw new Error('Invalid native authorization attempt')
      await this.withdraw()
      return provider.getState()
    })
  }

  /**
   * @param owner - approved window; its close automatically revokes renderer admission.
   * @returns admission disposer.
   */
  attach(owner: AuthorizationOwner): () => void {
    const existing = this.owners.get(owner)
    if (existing !== undefined) return existing
    const release = () => { this.owners.delete(owner); owner.removeListener('closed', release) }
    this.owners.set(owner, release)
    owner.on('closed', release)
    return release
  }

  /** Withdraw the attempt before Host restart, update installation or application quit. */
  async withdraw(): Promise<void> {
    this.starting?.abort()
    this.starting = undefined
    const id = this.attempt
    this.attempt = undefined
    this.surface.close()
    if (id !== undefined) await this.provider?.cancel(id)
    await this.surface.closeAndWait()
  }

  /** Revoke renderer admission and await all owned Host and browser work. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    for (const channel of Object.values(NATIVE_AUTHORIZATION_IPC)) ipcMain.removeHandler(channel)
    for (const release of this.owners.values()) release()
    await this.withdraw()
    await Promise.allSettled(this.tasks)
    await this.surface.dispose()
  }

  private track(task: Promise<unknown>): void {
    this.tasks.add(task)
    void task.finally(() => { this.tasks.delete(task) }).catch((_error: unknown) => {
      // A withdrawn attempt cannot regain admission; the next explicit operation reports availability.
    })
  }
}
