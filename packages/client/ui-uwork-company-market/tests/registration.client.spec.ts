// @vitest-environment jsdom
/** The company tab and its Remote namespace leave with their plugin and slot declaration. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it, onTestFinished, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

it.each([true, false])('waits for the Plugins tab declaration and releases it (declared first=%s)', async (first) => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  hostApply()
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const unmount = vi.fn(async () => {})
  const mount = vi.fn(async () => unmount)
  ctx.provide('remote', { $mount: mount, uworkCompanyMarket: { search: vi.fn() } } as never)
  ctx.provide('remote.uworkCompanyMarket', {} as never)
  const declare = () => ctx.effect(() => slots.register({ name: 'root', children: {
    'plugins.tab': { kind: 'list', scope: 'root' },
  } } as never, () => null))
  let undeclare = first ? declare() : undefined
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  expect(mount).toHaveBeenCalledTimes(1)
  if (!first) { undeclare = declare(); await Promise.resolve() }
  expect(slots.entries('plugins.tab')).toHaveLength(1)
  const entry = slots.entries('plugins.tab')[0]!
  expect(resolveSlotLabel(entry.options.label)).toBe('Company market')
  expect(typeof entry.inject!().start).toBe('function')
  await undeclare?.()
  expect(slots.entries('plugins.tab')).toHaveLength(0)
  declare()
  await Promise.resolve()
  expect(slots.entries('plugins.tab')).toHaveLength(1)
  await fiber.dispose()
  expect(slots.entries('plugins.tab')).toHaveLength(0)
  expect(unmount).toHaveBeenCalledTimes(1)
})
