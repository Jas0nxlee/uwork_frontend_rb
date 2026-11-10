// @vitest-environment jsdom
/** UWork registrations follow declaration and plugin lifetimes, independently of conversation state. */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { apply, inject } from '../src/client/index.ts'
import { UWorkFrame, UWorkMark, UWorkHeroMark, UWorkName, UWorkTitle } from '../src/client/Brand.tsx'
import { en } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { cleanup(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const holes = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark',
  'conversation.hero.brand.title', 'conversation.hero.frame'] as const

it('mounts the Host entry without Client services', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin({ apply: hostApply }).await()
})

async function setup(declareFirst = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const copy = vi.fn(() => () => { withdrawn() })
  const withdrawn = vi.fn()
  ctx.provide('locale', { register: copy } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => ctx.effect(() => slots.register({ name: 'root', children: Object.fromEntries(holes.map(name => [name,
    { kind: name === 'conversation.hero.frame' ? 'hoc' : 'single', scope: 'root' }])) } as never, () => null))
  const undeclare = declareFirst ? declare() : undefined
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  return { ctx, slots, fiber, declare, undeclare, copy, withdrawn }
}

it.each([true, false])('attaches to declarations before=%s and withdraws every contribution on unload', async (declareFirst) => {
  const h = await setup(declareFirst)
  if (!declareFirst) { h.declare(); await Promise.resolve() }
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(1)
  expect(h.copy).toHaveBeenCalledTimes(1)
  await h.fiber.dispose()
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(0)
  expect(h.withdrawn).toHaveBeenCalledTimes(1)
})

it('releases occupants when their owner disappears and registers them when the owner returns', async () => {
  const h = await setup()
  await h.undeclare?.()
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(0)
  h.declare()
  await Promise.resolve()
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(1)
})

it('renders theme-inheriting marks and locale-owned wordmarks at their host sizes', () => {
  const view = render(<UWorkMark {...{ size: 24 } as Parameters<typeof UWorkMark>[0]} />)
  expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  expect(view.container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
  view.rerender(<UWorkHeroMark {...{ size: 34, className: 'home-mark' } as Parameters<typeof UWorkHeroMark>[0]} />)
  expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('34')
  expect(view.container.querySelector('svg')?.getAttribute('class')).toBe('home-mark')
  view.rerender(<UWorkName t={makeTranslate(en)} />)
  expect(view.getByRole('img', { name: 'UWork' }).hasAttribute('data-uwork-name')).toBe(true)
  view.rerender(<UWorkTitle t={makeTranslate(en)} />)
  expect(view.getByRole('img', { name: 'UWork' }).hasAttribute('data-uwork-title')).toBe(true)
})

it('shows UCAS only on the home while keeping the same input through a phase change', () => {
  const view = render(<UWorkFrame hero><input aria-label="draft" defaultValue="keep this draft" /></UWorkFrame>)
  const input = view.getByRole('textbox')
  expect(view.container.querySelector('[data-uwork-home-background="UCAS"]')).not.toBeNull()
  view.rerender(<UWorkFrame hero={false}><input aria-label="draft" defaultValue="keep this draft" /></UWorkFrame>)
  expect(view.container.querySelector('[data-uwork-home-background]')).toBeNull()
  expect(view.getByRole('textbox')).toBe(input)
  expect(input).toHaveProperty('value', 'keep this draft')
})
