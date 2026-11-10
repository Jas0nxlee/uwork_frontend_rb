/** Word editor body; the owning controller retains engines and document state through remounts. */
import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'
import { Button, Checkbox, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { OfficeChoice, OfficeController, OfficeEntryState, WordCommand } from './controller.ts'
import css from './Office.module.css'

/** Session-bound callbacks and the framework-bound Office presentation source. */
export interface OfficeFace {
  readonly hooks: { readonly office: HostObservable<Readonly<Partial<Record<TabId, OfficeEntryState>>>>
  }
  /**
   * Attach the retained editor to the current tab viewport.
   * @param request - tab occurrence and viewport.
   * @returns physical attachment cleanup.
   */
  readonly mount: OfficeController['mount']
  /**
   * Publish a captured snapshot through guarded file storage.
   * @param id - owning tab.
   */
  readonly save: (id: TabId) => void
  /**
   * Replace the editor only after resolving any unsaved edits.
   * @param id - owning tab.
   */
  readonly reload: (id: TabId) => void
  /**
   * Apply a formatting action to the writable active editor.
   * @param id - owning tab.
   * @param command - formatting action.
   */
  readonly command: (id: TabId, command: WordCommand) => void
  /**
   * Record the revision-tracking preference as an unsaved document change.
   * @param id - owning tab.
   * @param enabled - revision recording preference.
   */
  readonly tracking: (id: TabId, enabled: boolean) => void
  /**
   * Resolve the decision displayed for this tab occurrence.
   * @param id - owning tab.
   * @param choice - unsaved-edit decision.
   */
  readonly choose: (id: TabId, choice: OfficeChoice) => void
  /**
   * Import the converted document after the user accepts the reported loss.
   * @param id - owning tab.
   */
  readonly acceptLoss: (id: TabId) => void
}

/** Slot-derived tab, injected callbacks, reactive presentation, and localized copy. */
export type OfficeBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<OfficeFace> & PropsLocale<'uworkOfficeEditor'>

/**
 * @param props - framework-composed file editor inputs.
 * @returns the editor and its owned decision surfaces.
 */
export function OfficeBody({
  useTabInfo, useResource, useOffice, mount, save, reload, command, tracking, choose, acceptLoss, t,
}: OfficeBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const resource = useResource<'file'>(tab.contentId)
  const state = useOffice(records => records[tab.id])
  const viewport = useId()
  const canRead = resource.status !== 'none'
  useEffect(() => {
    if (!canRead) return
    return mount({ tabId: tab.id, address: tab.contentId, viewportId: viewport, signal: tab.signal })
  }, [canRead, mount, tab.id, tab.contentId, tab.signal, viewport])
  const ready = state?.document.phase === 'ready'
  const writable = ready && state.canEdit && !state.busy
  const pending = state === undefined || state.document.phase === 'loading' || state.busy
  return <section data-uwork-office-editor aria-label={t('type.label')} className={css.root} onKeyDownCapture={(event) => {
    if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      save(tab.id)
    }
  }}>
    <div className={css.toolbar} role="toolbar" aria-label={t('toolbar')}>
      <Button size="sm" variant="primary" disabled={!writable || state.document.saving} onClick={() => { save(tab.id) }}>{t('save')}</Button>
      <Button size="sm" disabled={pending || state.document.saving} onClick={() => { reload(tab.id) }}>{t('reload')}</Button>
      {(['undo', 'redo', 'bold', 'italic', 'underline'] as const).map(action =>
        <Button key={action} size="sm" variant="toolbar" disabled={!writable} onClick={() => { command(tab.id, action) }}>{t(action)}</Button>)}
      <Checkbox label={t('tracking')} disabled={!writable} checked={state?.trackChanges ?? true}
        onChange={(enabled) => { tracking(tab.id, enabled) }} />
    </div>
    <div className={css.status} role="status" aria-live="polite">
      <span className={css.path} title={state?.document.path ?? tab.title}>{state?.document.path ?? tab.title}</span>
      <span>{state?.document.saving ? t('saving') : state?.document.dirty ? t('unsaved') : ready ? t('saved') : ''}</span>
      {ready && !state.canEdit && <span>{t('readonly')}</span>}
    </div>
    {!canRead && <div className={css.notice} role="alert">{t('unavailable')}</div>}
    {state?.error !== undefined && <div className={css.notice} role="alert">
      <span>{t(`error.${state.error}`)}</span>
      <Button size="sm" disabled={pending} onClick={() => { reload(tab.id) }}>{t('retry')}</Button>
    </div>}
    {state !== undefined && state.lossCount > 0 && <div className={css.notice} role="alert">
      <span>{t('loss.body', { count: state.lossCount })}</span>
      <Button size="sm" disabled={pending || !state.canEdit} onClick={() => { acceptLoss(tab.id) }}>{t('loss.accept')}</Button>
    </div>}
    <div className={css.paper} id={viewport}>
      {pending && canRead && <div className={css.loading} role="status" aria-label={t('loading')}><StateDot state="ongoing" size={28} /></div>}
    </div>
    <Modal open={state?.prompt !== undefined} title={state?.prompt === 'reload' ? t('reload') : t('close.title')}
      closeLabel={t('cancel')} onClose={() => { choose(tab.id, 'cancel') }}
      description={t('close.body', { path: state?.document.path ?? tab.title })}
      footer={<>
        <Button size="sm" onClick={() => { choose(tab.id, 'cancel') }}>{t('cancel')}</Button>
        <Button size="sm" onClick={() => { choose(tab.id, 'discard') }}>{t('discard')}</Button>
        <Button size="sm" variant="primary" disabled={!state?.canEdit} onClick={() => { choose(tab.id, 'save') }}>{t('save')}</Button>
      </>} />
  </section>
}
