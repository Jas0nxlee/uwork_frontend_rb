// @vitest-environment jsdom
/** UWork registrations follow declaration and plugin lifetimes, independently of conversation state. */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ThemeRuntime, type ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { apply, inject } from '../src/client/index.ts'
import { UWorkFrame, UWorkMark, UWorkHeroMark, UWorkName, UWorkTitle } from '../src/client/Brand.tsx'
import { en } from '../src/client/locales.ts'
import { uworkTokens } from '../src/client/theme.ts'
import { UWorkNavigation } from '../src/client/Navigation.tsx'
import { apply as hostApply } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { cleanup(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const holes = ['sidebar.frame', 'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark',
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
  const restoreTheme = vi.fn()
  const overrideTokens = vi.fn(() => restoreTheme)
  ctx.provide('theme', { overrideTokens } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => ctx.effect(() => slots.register({ name: 'root', children: Object.fromEntries(holes.map(name => [name,
    { kind: name === 'conversation.hero.frame' || name === 'sidebar.frame' ? 'hoc' : 'single', scope: 'root' }])) } as never, () => null))
  const undeclare = declareFirst ? declare() : undefined
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  return { ctx, slots, fiber, declare, undeclare, copy, withdrawn, overrideTokens, restoreTheme }
}

it.each([true, false])('attaches to declarations before=%s and withdraws every contribution on unload', async (declareFirst) => {
  const h = await setup(declareFirst)
  if (!declareFirst) { h.declare(); await Promise.resolve() }
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(1)
  expect(h.copy).toHaveBeenCalledTimes(1)
  expect(h.overrideTokens).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-uwork', uworkTokens)
  expect(uworkTokens['--dsw-alias-bg-base']).toEqual({ light: '#f5f5f5', dark: '#0f0f0f' })
  await h.fiber.dispose()
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(0)
  expect(h.withdrawn).toHaveBeenCalledTimes(1)
  expect(h.restoreTheme).toHaveBeenCalledTimes(1)
})

it('releases occupants when their owner disappears and registers them when the owner returns', async () => {
  const h = await setup()
  await h.undeclare?.()
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(0)
  h.declare()
  await Promise.resolve()
  for (const name of holes) expect(h.slots.entries(name)).toHaveLength(1)
})

it('follows the native light/dark preference and restores the previous palette on withdrawal', () => {
  const ctx = new Context()
  contexts.push(ctx)
  const host = stubConfigForm<ThemeSettings>()
  const theme = new ThemeRuntime(ctx, host.scope)
  const original = theme.getTheme().active.tokens
  const withdraw = theme.overrideTokens('uwork', uworkTokens)
  expect(theme.getTheme().preference).toBe('system')
  expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('#f5f5f5')
  theme.setTheme('dark')
  expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('#0f0f0f')
  expect(theme.getTheme().active.tokens['--dsw-specific-input-major']).toBe('#2b2b2b')
  withdraw()
  expect(theme.getTheme().preference).toBe('dark')
  expect(theme.getTheme().active.tokens).toEqual(original)
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

it('keeps navigation controls mounted across desktop, rail and drawer presentation', () => {
  const view = render(<UWorkNavigation collapsed={false} drawer={false}><button>Workspace</button></UWorkNavigation>)
  const control = view.getByRole('button', { name: 'Workspace' })
  control.focus()
  expect(view.container.querySelector('[data-uwork-navigation="compact"]')).not.toBeNull()
  view.rerender(<UWorkNavigation collapsed drawer={false}><button>Workspace</button></UWorkNavigation>)
  expect(view.container.querySelector('[data-uwork-navigation="rail"]')).not.toBeNull()
  expect(view.getByRole('button')).toBe(control)
  expect(document.activeElement).toBe(control)
  view.rerender(<UWorkNavigation collapsed={false} drawer><button>Workspace</button></UWorkNavigation>)
  expect(view.container.querySelector('[data-uwork-navigation="drawer"]')).not.toBeNull()
  expect(view.getByRole('button')).toBe(control)
})
