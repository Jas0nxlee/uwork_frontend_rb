// @vitest-environment jsdom
/** Real Slot renderer composition preserves native children through home and interaction phases. */
import { useState, type ReactNode } from 'react'
import { fireEvent } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ThemeRuntime, type ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import { UserMessageBubble } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HocShare, PropsRenderSlots, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const runtimes: SlotTestRuntime[] = []
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose())) })
const declarations = { 'conversation.hero.frame': { kind: 'hoc', scope: 'root' }, 'conversation.composer.frame': { kind: 'hoc', scope: 'root' } } as const
const mount = async () => {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const theme = new ThemeRuntime(runtime.ctx, stubConfigForm<ThemeSettings>().scope)
  runtime.ctx.provide('theme', theme)
  const handle = await runtime.mount({ inject, apply })
  return { runtime, theme, handle }
}
function ExistingBrand({ children }: HocShare<SlotMap['conversation.hero.frame']>): ReactNode { return <div data-existing-brand>{children}</div> }
function ExistingInteraction({ children }: HocShare<SlotMap['conversation.composer.frame']>): ReactNode { return <div data-existing-interaction>{children}</div> }
function Owner(props: PropsRenderSlots<'conversation.hero.frame' | 'conversation.composer.frame'>): ReactNode {
  const [active, setActive] = useState(false)
  return <>
    <button onClick={() =>{  setActive(value => !value) }}>Change phase</button>
    {props.renderSlot('conversation.hero.frame', { hero: !active }, { children: <>
      <UserMessageBubble>Existing user message 企业消息 with a long filename</UserMessageBubble>
      {props.renderSlot('conversation.composer.frame', { interactionKind: active ? 'approval' : undefined }, { children: <>
        <input aria-label="Native draft" defaultValue="Retain the queued draft" />
        <button aria-label="Native model menu" onClick={() => {}}>Model</button>
      </> })}
    </> })}
  </>
}

it('mounts an inert Host entry', async () => { const { runtime } = await mount(); await runtime.mount({ apply: hostApply }) })
it('composes with existing brand and interaction layers without replacing or duplicating native children', async () => {
  const { runtime } = await mount()
  await runtime.root.declare(declarations, Owner)
  runtime.slots.register({ name: 'conversation.hero.frame', id: 'existing-brand', order: 0 }, ExistingBrand)
  runtime.slots.register({ name: 'conversation.composer.frame', id: 'existing-interaction', order: 0 }, ExistingInteraction)
  const view = runtime.renderRoot()
  const draft = view.getByRole('textbox', { name: 'Native draft' }) as HTMLInputElement
  fireEvent.change(draft, { target: { value: 'Changed draft 企业测试 with wrapping content' } })
  draft.focus()
  fireEvent.click(view.getByRole('button', { name: 'Change phase' }))
  expect(view.getByRole('textbox', { name: 'Native draft' })).toBe(draft)
  expect(draft.value).toBe('Changed draft 企业测试 with wrapping content')
  expect(document.activeElement).toBe(draft)
  expect(view.getAllByRole('button', { name: 'Native model menu' })).toHaveLength(1)
  expect(view.container.querySelectorAll('[data-uwork-conversation]')).toHaveLength(1)
  expect(view.container.querySelectorAll('[data-uwork-composer]')).toHaveLength(1)
  expect(view.container.querySelector('[data-existing-brand] [data-uwork-conversation]')).not.toBeNull()
  expect(view.container.querySelector('[data-existing-interaction] [data-uwork-composer]')).not.toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Change phase' }))
  expect(view.getByRole('textbox', { name: 'Native draft' })).toBe(draft)
})
it('follows both native themes and withdraws every owned layer on unload', async () => {
  const { runtime, theme, handle } = await mount()
  await runtime.root.declare(declarations, Owner)
  expect(theme.getTheme().active.tokens['--dsw-specific-bubble']).toBe('#e6e6e6')
  theme.setTheme('dark')
  expect(theme.getTheme().active.tokens['--dsw-specific-bubble']).toBe('#363636')
  expect(runtime.slots.entries('conversation.hero.frame')).toHaveLength(1)
  expect(runtime.slots.entries('conversation.composer.frame')).toHaveLength(1)
  await handle.dispose()
  expect(runtime.slots.entries('conversation.hero.frame')).toHaveLength(0)
  expect(runtime.slots.entries('conversation.composer.frame')).toHaveLength(0)
  expect(theme.getTheme().active.tokens['--dsw-specific-bubble']).not.toBe('#363636')
})
it('waits for declarations and restores its layers after the owner is replaced', async () => {
  const { runtime } = await mount()
  expect(runtime.slots.entries('conversation.hero.frame')).toHaveLength(0)
  await runtime.root.declare(declarations, Owner)
  expect(runtime.slots.entries('conversation.hero.frame')).toHaveLength(1)
  runtime.root.release()
  expect(runtime.slots.entries('conversation.hero.frame')).toHaveLength(0)
  await runtime.root.declare(declarations, Owner)
  expect(runtime.slots.entries('conversation.hero.frame')).toHaveLength(1)
})
