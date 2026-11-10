// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry as Slots } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ComposedProps, FactoryComponentPropsOf, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { ApprovalCard } from '../../ui-approval/src/client/ApprovalCard.tsx'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { InteractionFrame } from '../src/client/InteractionFrame.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

type FrameProps = ComposedProps<'conversation.composer.frame', never, never, undefined, object>
function Frame(props: { interactionKind: string | undefined; children: ReactNode }) {
  return <InteractionFrame {...props as FrameProps} />
}

function FrameOwner({ renderSlot }: PropsRenderSlots<'conversation.composer.frame'>) {
  return renderSlot('conversation.composer.frame', { interactionKind: undefined }, {
    children: <textarea aria-label="Native owner draft" />,
  })
}

const contexts: Context[] = []
afterEach(async () => { cleanup(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

it.each([true, false])('owns only a frame contribution when declaration exists first=%s', async (first) => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Slots)
  const declare = () => ctx.effect(() => ctx.slots.register({ name: 'root', inject: () => ({}), children: {
    'conversation.composer.frame': { kind: 'hoc', scope: 'root' },
  } }, FrameOwner))
  const remove = first ? declare() : undefined
  const plugin = await ctx.plugin({ inject, apply })
  if (!first) { declare(); await Promise.resolve() }
  expect(ctx.slots.entries('conversation.composer.frame')).toHaveLength(1)
  await plugin.dispose()
  expect(ctx.slots.entries('conversation.composer.frame')).toHaveLength(0)
  await remove?.()
})

it('keeps the resident input DOM and draft through ordinary and pending states', () => {
  const child = <textarea aria-label="Resident draft" defaultValue="保留 draft" />
  const view = render(<Frame interactionKind={undefined}>{child}</Frame>)
  const editor = screen.getByRole('textbox')
  editor.focus()
  fireEvent.change(editor, { target: { value: 'modified 中英 draft' } })
  for (const kind of ['approval', 'question', 'plan-review', 'unrelated', undefined]) {
    view.rerender(<Frame interactionKind={kind}>{child}</Frame>)
    expect(screen.getByRole('textbox')).toBe(editor)
    expect(editor).toHaveProperty('value', 'modified 中英 draft')
    expect(document.activeElement).toBe(editor)
  }
})

it.each(['allow', 'reject', 'escape'] as const)('retains native approval settlement through %s', async (action) => {
  const allow = vi.fn(async () => {}), reject = vi.fn(async () => {})
  const props = {
    requestKey: 'owned-request', title: 'Review this tool request 请求'.repeat(8),
    description: 'The native card retains decisions, keyboard handling and settlement.',
    canAnswer: () => true, onAllow: allow, onReject: reject,
    renderSlot: vi.fn(() => null),
    t: (key: string) => ({ reject: 'Reject', allowOnce: 'Allow once', 'detail.aria': 'Request detail' })[key] ?? key,
  } as FactoryComponentPropsOf<'conversation.approval.card'>
  render(<Frame interactionKind="approval"><ApprovalCard {...props} /></Frame>)
  if (action === 'escape') {
    const detail = screen.getByRole('group', { name: 'Request detail' })
    detail.focus()
    fireEvent.keyDown(detail, { key: 'Escape' })
  } else fireEvent.click(screen.getByRole('button', { name: action === 'allow' ? 'Allow once' : 'Reject' }))
  await waitFor(() => { expect(action === 'allow' ? allow : reject).toHaveBeenCalledOnce() })
  expect(action === 'allow' ? reject : allow).not.toHaveBeenCalled()
})

it('keeps native submitting and retry behavior after an answer failure', async () => {
  const answer = Promise.withResolvers<undefined>()
  const allow = vi.fn().mockReturnValueOnce(answer.promise).mockResolvedValue(undefined)
  const props = {
    requestKey: 'retry-request', title: 'Retry remains with the native card', canAnswer: () => true,
    onAllow: allow, onReject: vi.fn(async () => {}), renderSlot: vi.fn(() => null), t: (key: string) => key,
  } as FactoryComponentPropsOf<'conversation.approval.card'>
  render(<Frame interactionKind="approval"><ApprovalCard {...props} /></Frame>)
  const button = screen.getByRole('button', { name: 'allowOnce' })
  fireEvent.click(button)
  expect(button).toHaveProperty('disabled', true)
  await act(async () => { answer.reject(new Error('synthetic answer failure')) })
  await waitFor(() => { expect(button).toHaveProperty('disabled', false) })
  fireEvent.click(button)
  expect(allow).toHaveBeenCalledTimes(2)
})

it('loads its Host entry without browser services', () => { expect(() => { hostApply() }).not.toThrow() })
