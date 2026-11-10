// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EnterpriseSection, type EnterpriseSectionProps } from '../src/client/Section.tsx'
import { dictionaries, en } from '../src/client/locales.ts'
import type { ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { EnterpriseData } from '../src/client/resource.ts'
import type { ModelProvisioningState } from '@deepseek-ai/dsh-uwork-model-provisioning/types'
import type { MutationState } from '../src/client/store.ts'

afterEach(cleanup)
const account: EnterpriseData = { identity: { status: 'authenticated', orgId: 'org-a', userId: 'user-1', name: 'Enterprise User', expiresAt: 2000, generation: 'gen-a' } as EnterpriseData['identity'], organizations: [{ orgId: 'org-a', label: 'Research organization' }, { orgId: 'org-b', label: 'Other organization' }] }
function props({ resource = { status: 'live', value: account, failure: undefined }, model = { status: 'live', value: { status: 'key-required' }, failure: undefined }, mutations = { owner: '[1,"org-a","user-1","gen-a"]', signingOut: false, signOutFailed: false, creating: false, createUnknown: false, completedCreation: 0 } }: {
  resource?: ResourceSnapshot<EnterpriseData>
  model?: ResourceSnapshot<ModelProvisioningState>
  mutations?: MutationState
} = {}): EnterpriseSectionProps {
  return {
    t: makeTranslate(en), useResource: (address: string) => address.includes('uwork-enterprise-models') ? model : resource,
    useMutations: selector => selector(mutations), useEnterpriseConnection: selector => selector({ id: 1, host: { home: '/home/test' } }),
    enterOwner: vi.fn(), signOut: vi.fn(async () => {}), createManagedKey: vi.fn(async () => {}),
  } as EnterpriseSectionProps
}
it.each(Object.entries(dictionaries))('owns all account and confirmation copy in locale %s', async (_locale, dictionary) => {
  const p = props(); const view = render(<EnterpriseSection {...p} t={makeTranslate(dictionary)} />)
  expect(view.getByRole('heading', { name: dictionary.title })).not.toBeNull()
  expect(view.getAllByText('Research organization')).toHaveLength(2)
  expect(view.getByText(dictionary.managedNotice)).not.toBeNull()
  fireEvent.click(view.getByRole('button', { name: dictionary.createKey }))
  expect(p.createManagedKey).not.toHaveBeenCalled()
  const dialog = view.getByRole('dialog', { name: dictionary.confirmTitle })
  expect(within(dialog).getByText(dictionary.confirmDescription)).not.toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: dictionary.confirmCreate }))
  await waitFor(() => { expect(p.createManagedKey).toHaveBeenCalledOnce() })
  fireEvent.click(view.getByRole('button', { name: dictionary.signOut }))
  await waitFor(() => { expect(p.signOut).toHaveBeenCalledOnce() })
})
it('closes key confirmation on Cancel and Escape without issuing a POST', () => {
  const p = props(); const view = render(<EnterpriseSection {...p} />)
  fireEvent.click(view.getByRole('button', { name: en.createKey }))
  fireEvent.click(view.getByRole('button', { name: en.cancel }))
  expect(view.queryByRole('dialog')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.createKey }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.queryByRole('dialog')).toBeNull()
  expect(p.createManagedKey).not.toHaveBeenCalled()
})
it.each(['loading', 'none', 'failed'] as const)('shows %s account state without implying authentication', (status) => {
  const view = render(<EnterpriseSection {...props({ resource: { status, value: undefined, failure: undefined } })} />)
  if (status === 'loading') expect(view.getByRole('status', { name: en.loading })).not.toBeNull()
  else { expect(view.getByRole('alert').textContent).toContain(en.readFailed); fireEvent.click(view.getByRole('button', { name: en.retry })) }
  expect(view.queryByText(en.authenticated)).toBeNull()
})
it.each(['signed-out', 'restoring'] as const)('renders %s without account-only controls', (status) => {
  const view = render(<EnterpriseSection {...props({ resource: { status: 'live', value: { ...account, identity: { status } }, failure: undefined } })} />)
  expect(view.getByRole('status').textContent).toBe(status === 'restoring' ? en.restoring : en.signedOut)
  expect(view.queryByRole('button', { name: en.signOut })).toBeNull()
})
it('retains details as stale after a resource failure and supports raw organization identity fallback', () => {
  const view = render(<EnterpriseSection {...props({ resource: { status: 'failed', value: { ...account, organizations: [] }, failure: undefined } })} />)
  expect(view.getByText(en.retained)).not.toBeNull()
  expect(view.getByText('org-a')).not.toBeNull()
  expect(view.getByRole('button', { name: en.signOut }).hasAttribute('disabled')).toBe(true)
  expect(view.queryByText(en.authenticated)).toBeNull()
})
it.each(['idle', 'signed-out', 'syncing', 'capabilities-required', 'key-outcome-unknown', 'error', 'ready'] as const)('presents safe %s model status', (status) => {
  const model: ModelProvisioningState = status === 'ready' ? { status, provider: 'managed', modelIds: ['model-a'], needsModelSelection: true } : status === 'error' ? { status, reason: 'gateway' } : { status }
  const view = render(<EnterpriseSection {...props({ model: { status: 'live', value: model, failure: undefined } })} />)
  if (status === 'ready') { expect(view.getByText('model-a')).not.toBeNull(); expect(view.getByText(en.selectModel)).not.toBeNull() }
  if (status === 'key-outcome-unknown') expect(view.getByRole('alert').textContent).toContain(en.keyUnknown)
})
it('preserves existing model selection and displays loading/read failure independently', () => {
  const view = render(<EnterpriseSection {...props({ model: { status: 'live', value: { status: 'ready', provider: 'managed', modelIds: [], needsModelSelection: false }, failure: undefined } })} />)
  expect(view.queryByText(en.selectModel)).toBeNull()
  expect(view.queryByText('managed')).toBeNull()
  view.rerender(<EnterpriseSection {...props({ model: { status: 'loading', value: undefined, failure: undefined } })} />)
  expect(view.getByText(en.modelsLoading)).not.toBeNull()
  view.rerender(<EnterpriseSection {...props({ model: { status: 'failed', value: undefined, failure: undefined } })} />)
  expect(view.getByText(en.modelsFailed)).not.toBeNull()
})
it('blocks mutations while pending and never offers creation after an uncertain POST', () => {
  const mutations = { owner: '[1,"org-a","user-1","gen-a"]', signingOut: true, signOutFailed: true, creating: true, createUnknown: true, completedCreation: 1 }
  const view = render(<EnterpriseSection {...props({ mutations })} />)
  expect(view.getByText(en.signingOut)).not.toBeNull()
  expect(view.getByText(en.signOutFailed)).not.toBeNull()
  expect(view.getByText(en.keyUnknown)).not.toBeNull()
  expect(view.queryByRole('button', { name: en.createKey })).toBeNull()
  for (const button of view.getAllByRole('button')) expect(button.hasAttribute('disabled')).toBe(true)
})
it.each(['connection', 'identity'] as const)('closes a previous confirmation when %s owner changes', (kind) => {
  const p = props(); const view = render(<EnterpriseSection {...p} />)
  fireEvent.click(view.getByRole('button', { name: en.createKey }))
  expect(view.getByRole('dialog', { name: en.confirmTitle })).not.toBeNull()
  const next = props({ resource: { status: 'live', value: kind === 'identity' ? { ...account, identity: { ...account.identity, userId: 'user-b' } as EnterpriseData['identity'] } : account, failure: undefined } })
  if (kind === 'connection') next.useEnterpriseConnection = selector => selector({ id: 2, host: { home: '/host-b' } })
  view.rerender(<EnterpriseSection {...next} />)
  expect(view.queryByRole('dialog', { name: en.confirmTitle })).toBeNull()
  expect(p.createManagedKey).not.toHaveBeenCalled()
})
