// @vitest-environment jsdom
/** Real Slots, Locale, Resources and stream supervisor consume a synthetic external Remote API. */
import { act, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as resourcesApply, inject as resourcesInject } from '@deepseek-ai/dsh-client-resources/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { remote } from './fixtures.client.ts'

it('assembles the native main slot and resource hook, then releases them on unload and reload', async () => {
  hostApply()
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({ main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } })
  await runtime.mount({ inject: resourcesInject, apply: resourcesApply })
  const external = remote()
  runtime.remote.provideNamespaces({ uworkGateway: external.uworkGateway })
  Object.assign(runtime.remote, { $stream: external.$stream })
  const unmount = vi.fn(async () => {})
  vi.spyOn(runtime.remote, '$mount').mockResolvedValue(unmount)
  const plugin = { inject, apply }
  const feature = await runtime.mount(plugin)
  expect(runtime.slots.entries('sidebar.panellist')).toHaveLength(1)
  expect(resolveSlotLabel(runtime.slots.entries('sidebar.panellist')[0]!.options.label)).toBe('Enterprise usage')
  expect(runtime.slots.entries('main')).toHaveLength(1)
  const view = runtime.renderSlot('main', {}, { entryKey: 'uwork-usage' })
  await waitFor(() =>{  expect(view.view.getByText('synthetic-model')).toBeTruthy() })
  expect(view.view.getAllByRole('table')).toHaveLength(2)
  await act(async () => { await feature.dispose() })
  expect(runtime.slots.entries('main')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.panellist')).toHaveLength(0)
  expect(unmount).toHaveBeenCalledTimes(1)
  await runtime.mount(plugin)
  expect(runtime.slots.entries('main')).toHaveLength(1)
})
