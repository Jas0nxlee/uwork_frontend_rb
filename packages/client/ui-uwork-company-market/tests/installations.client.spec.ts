/** Installation actions reconcile persisted results after rejection or a lost acknowledgement. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { RemoteError, type TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { InstallationController } from '../src/client/installations.ts'
import type { CompanyInstallations } from '@deepseek-ai/dsh-uwork-company-market/installation-types'

function setup() {
  let value: CompanyInstallations = { available: true, skills: [] }
  const remote = {
    installations: vi.fn<TypertClientRemote['uworkCompanyMarket']['installations']>(async () => ({ ok: true, value })),
    installSkill: vi.fn<TypertClientRemote['uworkCompanyMarket']['installSkill']>(async () => ({ ok: true, value: { slug: 'weather', version: '1', fingerprint: 'sha256:test', enabled: true, fileCount: 1 } })),
    setEnabled: vi.fn<TypertClientRemote['uworkCompanyMarket']['setEnabled']>(async () => ({ ok: true, value })),
    uninstallSkill: vi.fn<TypertClientRemote['uworkCompanyMarket']['uninstallSkill']>(async () => ({ ok: true, value })),
    search: vi.fn<TypertClientRemote['uworkCompanyMarket']['search']>(),
  }
  const controller = new InstallationController(remote)
  onTestFinished(() =>{  controller.dispose() })
  return { controller, remote, snapshot: () => controller.store.getSnapshot(), setValue: (next: CompanyInstallations) => { value = next } }
}

it('reads once, serializes management and refreshes after every completed mutation', async () => {
  const h = setup()
  h.controller.start(); h.controller.start()
  await vi.waitFor(() =>{  expect(h.snapshot().value?.available).toBe(true) })
  expect(h.remote.installations).toHaveBeenCalledTimes(1)
  h.controller.install('weather', '1')
  h.controller.install('duplicate', '1')
  await vi.waitFor(() =>{  expect(h.snapshot().pending).toBe(null) })
  expect(h.remote.installSkill).toHaveBeenCalledTimes(1)
  expect(h.remote.installations).toHaveBeenCalledTimes(2)
  h.controller.setEnabled('weather', false)
  await vi.waitFor(() =>{  expect(h.snapshot().pending).toBe(null) })
  expect(h.remote.setEnabled).toHaveBeenCalledWith('weather', false, expect.any(AbortSignal))
  h.controller.uninstall('weather')
  await vi.waitFor(() =>{  expect(h.snapshot().pending).toBe(null) })
  expect(h.remote.uninstallSkill).toHaveBeenCalledWith('weather', expect.any(AbortSignal))
})

it.each(['unchanged', 'committed', 'unknown'] as const)('keeps %s feedback while reconciling the actual saved state', async (outcome) => {
  const h = setup()
  h.controller.start()
  await vi.waitFor(() =>{  expect(h.snapshot().value).not.toBe(null) })
  h.remote.installSkill.mockResolvedValueOnce({ ok: false, error: new RemoteError('uwork-company-market/install-failed', 'failed', { outcome }) })
  h.controller.install('weather', '1')
  await vi.waitFor(() =>{  expect(h.snapshot().pending).toBe(null) })
  expect(h.snapshot().failure).toBe(outcome === 'unchanged' ? 'installationUnchanged' : outcome === 'committed' ? 'installationCommitted' : 'installationUnknown')
  expect(h.remote.installations).toHaveBeenCalledTimes(2)
  h.controller.refresh()
  await vi.waitFor(() =>{  expect(h.snapshot().failure).toBe(null) })
})

it('retains trusted rows when a refresh fails and refuses writes until a successful refresh', async () => {
  const h = setup()
  h.controller.start()
  await vi.waitFor(() =>{  expect(h.snapshot().value).not.toBe(null) })
  const previous = h.snapshot().value
  h.remote.installations.mockRejectedValueOnce(new Error('disconnected'))
  h.controller.refresh()
  await vi.waitFor(() =>{  expect(h.snapshot().failure).toBe('installationRead') })
  expect(h.snapshot().value).toBe(previous)
  h.controller.install('weather', '1')
  expect(h.remote.installSkill).not.toHaveBeenCalled()
})

it('reconciles a transport rejection as an uncertain write and suppresses work after disposal', async () => {
  const h = setup()
  h.controller.start()
  await vi.waitFor(() =>{  expect(h.snapshot().value).not.toBe(null) })
  h.remote.installSkill.mockRejectedValueOnce(new Error('lost acknowledgement'))
  h.controller.install('weather', '1')
  await vi.waitFor(() =>{  expect(h.snapshot().pending).toBe(null) })
  expect(h.snapshot().failure).toBe('installationUnknown')
  h.controller.dispose()
  h.controller.refresh(); h.controller.uninstall('weather')
  expect(h.remote.uninstallSkill).not.toHaveBeenCalled()
  expect(h.remote.installations).toHaveBeenCalledTimes(2)
})

it('reports structured read and package rejections without discarding previous rows', async () => {
  const h = setup()
  h.controller.start()
  await vi.waitFor(() =>{  expect(h.snapshot().value).not.toBe(null) })
  h.remote.installSkill.mockResolvedValueOnce({ ok: false, error: new RemoteError('uwork-company-market/invalid-package', 'rejected', { reason: 'fingerprint' }) })
  h.controller.install('weather', '1')
  await vi.waitFor(() =>{  expect(h.snapshot().failure).toBe('installationRejected') })
  h.remote.installations.mockResolvedValueOnce({ ok: false, error: new RemoteError('uwork-company-market/state-invalid', 'invalid', {}) })
  h.controller.refresh()
  await vi.waitFor(() =>{  expect(h.snapshot().failure).toBe('installationRead') })
})


it('suppresses obsolete reads and read rejections after disposal', async () => {
  const h = setup()
  const old = Promise.withResolvers<Awaited<ReturnType<typeof h.remote.installations>>>()
  h.remote.installations.mockImplementationOnce(() => old.promise)
  h.controller.start()
  h.controller.refresh()
  await vi.waitFor(() =>{  expect(h.snapshot().value).not.toBe(null) })
  const latest = h.snapshot()
  old.resolve({ ok: true, value: { available: false, skills: [] } })
  await old.promise
  expect(h.snapshot()).toBe(latest)
  const rejected = Promise.withResolvers<Awaited<ReturnType<typeof h.remote.installations>>>()
  h.remote.installations.mockImplementationOnce(() => rejected.promise)
  h.controller.refresh()
  const beforeDispose = h.snapshot()
  h.controller.dispose()
  rejected.reject(new Error('cancelled read'))
  await rejected.promise.catch(() => undefined)
  expect(h.snapshot()).toBe(beforeDispose)
})

it('aborts an active write when disposed and suppresses its late acknowledgement', async () => {
  const h = setup()
  h.controller.install('weather', '1')
  expect(h.remote.installSkill).not.toHaveBeenCalled()
  h.controller.start()
  await vi.waitFor(() =>{  expect(h.snapshot().value).not.toBe(null) })
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof h.remote.installSkill>>>()
  h.remote.installSkill.mockImplementationOnce(() => pending.promise)
  h.controller.install('weather', '1')
  const before = h.snapshot()
  h.controller.dispose()
  expect(h.remote.installSkill.mock.calls[0]![2]!.aborted).toBe(true)
  pending.resolve({ ok: false, error: new RemoteError('uwork-company-market/invalid-package', 'rejected', { reason: 'format' }) })
  await pending.promise
  expect(h.snapshot()).toBe(before)
})

it('does not publish a settled action after disposal during reconciliation', async () => {
  const h = setup()
  h.controller.start()
  await vi.waitFor(() =>{  expect(h.snapshot().value).not.toBe(null) })
  const read = Promise.withResolvers<Awaited<ReturnType<typeof h.remote.installations>>>()
  h.remote.installations.mockImplementationOnce(() => read.promise)
  h.controller.install('weather', '1')
  await vi.waitFor(() =>{  expect(h.remote.installations).toHaveBeenCalledTimes(2) })
  const before = h.snapshot()
  h.controller.dispose()
  read.resolve({ ok: true, value: { available: false, skills: [] } })
  await read.promise
  await Promise.resolve()
  expect(h.snapshot()).toBe(before)
})
