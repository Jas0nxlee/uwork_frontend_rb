/** Workbench account page reads safe resources and receives mutation actions only. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EMPTY_MUTATIONS, enterpriseOwner, type EnterpriseFace, type ManagedKeyBinding } from './store.ts'
import { ACCOUNT_ADDRESS, MODEL_ADDRESS } from './resource.ts'
import css from './Section.module.css'

/** Standard settings, localization, resources and mutation shares. */
export type EnterpriseSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'uworkEnterprise'> & InjectFace<EnterpriseFace>

/** Present account, organizations, and explicitly confirmed managed-key creation. */
export function EnterpriseSection({
  t, useResource, useMutations, useEnterpriseConnection, signOut, createManagedKey, enterOwner,
}: EnterpriseSectionProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [confirmation, setConfirmation] = useState<{ owner: string; binding: ManagedKeyBinding } | null>(null)
  const generation = useEnterpriseConnection(value => value?.id)
  const resource = useResource<'uwork-enterprise'>(`${ACCOUNT_ADDRESS}?connection=${generation}&revision=${revision}`)
  const data = resource.value
  const identity = data?.identity
  const authenticated = resource.status === 'live' && identity?.status === 'authenticated'
  const identityGeneration = identity?.status === 'authenticated' ? identity.generation : ''
  const binding = identity?.status === 'authenticated'
    ? { orgId: identity.orgId, userId: identity.userId, generation: identity.generation } : null
  const owner = enterpriseOwner(generation, binding)
  const mutations = useMutations(value => value.owner === owner ? value : EMPTY_MUTATIONS)
  useEffect(() => { enterOwner(owner) }, [enterOwner, owner])
  const modelResource = useResource<'uwork-enterprise-models'>(
    `${MODEL_ADDRESS}?connection=${generation}&authenticated=${authenticated}&generation=${identityGeneration}&revision=${revision}&completed=${mutations.completedCreation}&owner=${encodeURIComponent(owner)}`,
  )
  const model = modelResource.value
  const loading = resource.status === 'loading'
  const busy = loading || mutations.signingOut || mutations.creating
  const failed = resource.status === 'failed' || resource.status === 'none'
  const canCreate = authenticated && modelResource.status === 'live' && model?.status === 'key-required' && !mutations.createUnknown
  const refresh = () => { setRevision(value => value + 1) }
  return <section className={css.section} aria-label={t('title')} aria-busy={busy}>
    <div className={css.heading}>
      <h2 className={css.title}>{t('title')}</h2>
      <Button variant="ghost" size="sm" disabled={busy} onClick={refresh}>{t('refresh')}</Button>
    </div>
    {(failed || mutations.signOutFailed) && <div role="alert" className={css.failure}>
      <p>{t(mutations.signOutFailed ? 'signOutFailed' : 'readFailed')}</p>
      <Button variant="ghost" size="sm" disabled={busy} onClick={refresh}>{t('retry')}</Button>
    </div>}
    {loading && data === undefined && <div role="status" aria-label={t('loading')} className={css.loading}><StateDot state="ongoing" size={20} /></div>}
    {identity !== undefined && <div className={css.card}>
      {failed && <p className={css.meta}>{t('retained')}</p>}
      {!failed && !mutations.signOutFailed && <p className={css.status} role="status">{t(authenticated ? 'authenticated' : identity.status === 'restoring' ? 'restoring' : 'signedOut')}</p>}
      {identity.status === 'authenticated' && <>
        <dl className={css.details}>
          <dt>{t('name')}</dt><dd>{identity.name}</dd>
          <dt>{t('userId')}</dt><dd>{identity.userId}</dd>
          <dt>{t('organization')}</dt><dd>{data?.organizations.find(org => org.orgId === identity.orgId)?.label ?? identity.orgId}</dd>
        </dl>
        <div className={css.actions}>
          <Button variant="outline" size="sm" disabled={busy || !authenticated} onClick={() => { void signOut(owner).then(refresh) }}>{t('signOut')}</Button>
          {mutations.signingOut && <span role="status" className={css.meta}>{t('signingOut')}</span>}
        </div>
      </>}
      {identity.status === 'signed-out' && <p className={css.meta}>{t('returnToSignIn')}</p>}
    </div>}
    {data !== undefined && <section className={css.card} aria-label={t('organizations')}>
      <h3 className={css.title}>{t('organizations')}</h3>
      <p className={css.meta}>{t('organizationHint')}</p>
      <ul className={css.list}>{data.organizations.map(org => <li className={css.organization} key={org.orgId}>
        <span>{org.label}</span>{authenticated && org.orgId === identity.orgId && <span className={css.meta}>{t('current')}</span>}
      </li>)}</ul>
    </section>}
    {authenticated && <section className={css.card} aria-label={t('modelsTitle')}>
      <h3 className={css.title}>{t('modelsTitle')}</h3>
      <p className={css.meta}>{t('managedNotice')}</p>
      {(modelResource.status === 'loading' || mutations.creating) && <div role="status" className={css.actions}><StateDot state="ongoing" /><span className={css.meta}>{t('modelsLoading')}</span></div>}
      {modelResource.status === 'failed' && <p role="alert" className={css.failure}>{t('modelsFailed')}</p>}
      {(mutations.createUnknown || model?.status === 'key-outcome-unknown') && <p role="alert" className={css.failure}>{t('keyUnknown')}</p>}
      {!mutations.createUnknown && modelResource.status === 'live' && model !== undefined && <>
        {model.status === 'ready' ? <>
          <p className={css.status}>{t('modelsReady')}</p>
          <ul className={css.list}>{model.modelIds.map(id => <li className={css.organization} key={id}>{id}</li>)}</ul>
          {model.needsModelSelection && <p className={css.meta}>{t('selectModel')}</p>}
        </> : model.status !== 'key-outcome-unknown' && <p className={css.meta}>{t(model.status === 'key-required' ? 'keyRequired' : model.status === 'capabilities-required' ? 'capabilitiesRequired' : model.status === 'error' ? 'modelsFailed' : 'modelsLoading')}</p>}
      </>}
      <div className={css.actions}>
        <Button variant="ghost" size="sm" disabled={busy || modelResource.status === 'loading'} onClick={refresh}>{t('refreshModels')}</Button>
        {canCreate && binding !== null && <Button variant="outline" size="sm" disabled={busy}
          onClick={() => { setConfirmation({ owner, binding }) }}>{t('createKey')}</Button>}
      </div>
    </section>}
    <Modal open={confirmation?.owner === owner && canCreate} onClose={() => { setConfirmation(null) }} title={t('confirmTitle')} closeLabel={t('close')} description={t('confirmDescription')}
      footer={confirmation === null ? undefined : <>
        <Button variant="ghost" size="sm" data-modal-autofocus onClick={() => { setConfirmation(null) }}>{t('cancel')}</Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => {
          setConfirmation(null)
          void createManagedKey(confirmation.owner, confirmation.binding).then(refresh)
        }}>{t('confirmCreate')}</Button>
      </>} />
  </section>
}
