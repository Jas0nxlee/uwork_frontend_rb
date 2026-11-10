/** Register optional Word editing, its file calls, and tab-close decisions. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteFailure, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { Config } from '../config.ts'
import { OfficeBody, type OfficeFace } from './Body.tsx'
import { OfficeController } from './controller.ts'
import { OfficeDocumentError } from './document.ts'
import { createOfficeEngineQueue } from './engine-queue.ts'
import { en, zh, ja, es, fr, de, ru, pt } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Office editing, import decisions, and guarded file-save failures. */
    uworkOfficeEditor: import('./locales.ts').OfficeEditorKey
  }
}

/** Services used by the editor's registrations and authorized file calls. */
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'remote', 'remote.uworkOfficeStorage']

/**
 * Install the editor in this plugin lifetime; document data stays outside persisted tab layout.
 * @param ctx - Client context supplying the tab registry, slots, copy, and file namespace.
 */
export function apply(ctx: Context): void {
  const config = Config((globalThis as { __UWORK_OFFICE_EDITOR_CONFIG__?: unknown }).__UWORK_OFFICE_EDITOR_CONFIG__ ?? {})
  const id = '@deepseek-ai/dsh-client-ui-uwork-office-editor'
  const kind = 'uwork-office'
  const controllers = new Map<SessionId, OfficeController>()
  const engineQueue = createOfficeEngineQueue()
  const failed = (error: unknown): void => { ctx.logger.error(error) }
  ctx.effect(() => async () => {
    const pending = [...controllers.values()].map(controller => controller.dispose())
    controllers.clear()
    const results = await Promise.allSettled(pending)
    await engineQueue.idle()
    const failures = results.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
    if (failures.length > 0) throw new AggregateError(failures, 'Office controller cleanup failed')
  }, 'uwork-office.controllers')
  ctx.effect(() => ctx.locale.register('uworkOfficeEditor', { en, zh, ja, es, fr, de, ru, pt }), 'uwork-office.copy')
  ctx.effect(() => ctx.sidebarRight.registerCloseGuard(kind, {
    prepare: (sessionId, tab, signal) => controllers.get(sessionId)?.prepareClose(tab.id, signal) ?? Promise.resolve(true),
    failed,
  }), 'uwork-office.close-guard')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id, kind, patterns: ['*.docx'], priority: 'extension', keepMounted: true,
    canOpen: address => parseFileAddress(address)?.scope === 'session',
    title: (address) => {
      const file = parseFileAddress(address)
      return file?.path.split(/[\\/]/u).at(-1) ?? address
    },
  }), 'uwork-office.type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: id, locale: 'uworkOfficeEditor',
    inject: (sessionId): OfficeFace => {
      let controller = controllers.get(sessionId)
      if (controller === undefined) {
        controller = new OfficeController({
          files: owner => ({
            read: async (path, signal) => {
              const result = await ctx.remote.uworkOfficeStorage.read(owner, path, signal)
              if (!result.ok) throw fileFailure(result.error)
              return result.value
            },
            save: async (request, signal) => {
              const result = await ctx.remote.uworkOfficeStorage.save(owner, request, signal)
              if (!result.ok) throw fileFailure(result.error)
              return result.value
            },
          }),
          canWrite: async (owner, signal) => {
            const result = await ctx.remote.uworkOfficeStorage.capabilities(owner, signal)
            if (!result.ok) throw fileFailure(result.error)
            return result.value.writePolicy !== 'read-only'
          },
          word: { maxDocumentXmlBytes: config.maxDocumentXmlBytes, minRetainedTextRatio: config.minRetainedTextRatio,
            author: config.revisionAuthor, now: () => new Date().toISOString() },
          engineQueue,
          failed,
        })
        controllers.set(sessionId, controller)
      }
      const current = controller
      return {
        hooks: { office: current }, mount: request => current.mount(request),
        save: (tabId) => { void current.save(tabId).catch(failed) },
        reload: (tabId) => { void current.reload(tabId).catch(failed) },
        acceptLoss: (tabId) => { void current.acceptLoss(tabId).catch(failed) },
        command: (tabId, command) => { current.command(tabId, command) },
        tracking: (tabId, enabled) => { current.tracking(tabId, enabled) },
        choose: (tabId, choice) => { current.choose(tabId, choice) },
      }
    },
  }, OfficeBody)), 'uwork-office.body')
}

function fileFailure(error: RemoteFailure): OfficeDocumentError {
  if (error.code === 'gateway/cancelled') return new OfficeDocumentError('cancelled', { cause: error })
  if (error.code === 'office-file/failed') {
    switch (error.details.reason) {
      case 'FS_STALE_VERSION': case 'FS_NOT_OBSERVED': return new OfficeDocumentError('conflict', { cause: error })
      case 'FS_PERMISSION_DENIED': case 'FS_SANDBOX_DENIED': return new OfficeDocumentError('denied', { cause: error })
      case 'FS_TOO_LARGE': return new OfficeDocumentError('too-large', { cause: error })
      case 'busy': return new OfficeDocumentError('busy', { cause: error })
      default: return new OfficeDocumentError('failed', { cause: error })
    }
  }
  return new OfficeDocumentError('failed', { cause: error })
}
