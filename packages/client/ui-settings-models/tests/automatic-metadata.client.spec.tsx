// @vitest-environment jsdom
/** Custom provider writes require automatically resolved capabilities. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CustomProviderCard } from '../src/client/CustomProviderCard.tsx'
import { discoveredReasoningEfforts, resolveModelMetadata } from '../src/client/resolve-model-metadata.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function fixture(found = true) {
  const writeSettings = vi.fn<ModelsOperations['writeSettings']>().mockResolvedValue({ kind: 'refused', message: 'fixture stopped after write' })
  const discoverModels = vi.fn<ModelsOperations['discoverModels']>().mockResolvedValue({ kind: 'found', models: found
    ? [{ id: 'vision', contextWindow: 200000, maxTokens: 8000, inputModalities: ['text', 'image'], reasoningLevels: ['none', 'low', 'high', 'xhigh'] }]
    : [{ id: 'vision' }] })
  const storeCredential = vi.fn<ModelsOperations['storeCredential']>()
  const operations: ModelsOperations = { discoverModels, writeSettings, storeCredential, removeCredential: vi.fn() }
  return { operations, writeSettings, discoverModels, storeCredential }
}

function fill(operations: ModelsOperations) {
  render(<CustomProviderCard taken={[]} protocols={['openai-completions']} reasoningLevels={[]}
    revision={1} operations={operations} t={key => en[key]} readOnly={false} onClose={() => {}} automaticModelMetadata />)
  fireEvent.change(screen.getByLabelText(en.customRoute), { target: { value: 'personal' } })
  fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://private.example/v1' } })
  fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'private-key' } })
  fireEvent.click(screen.getByRole('button', { name: en.addModel }))
  fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'vision' } })
  fireEvent.click(screen.getByRole('button', { name: `${en.modelAdvanced} 1` }))
}

it('displays read-only capabilities and writes fetched values before credentials', async () => {
  const { operations, writeSettings, discoverModels, storeCredential } = fixture()
  fill(operations)
  expect(screen.getByLabelText<HTMLInputElement>(`${en.contextWindow} 1`).readOnly).toBe(true)
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: en.modelInputImage }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.create }))
  await waitFor(() => { expect(writeSettings).toHaveBeenCalledTimes(1) })
  expect(discoverModels).toHaveBeenCalledWith('llm-pi-ai', {
    provider: 'personal', baseURL: 'https://private.example/v1', api: 'openai-completions', modelIds: ['vision'],
  })
  const written = JSON.stringify(writeSettings.mock.calls[0]?.[1])
  expect(written).toContain('"contextWindow":200000')
  expect(written).toContain('"maxTokens":8000')
  expect(written).toContain('"input":["text","image"]')
  expect(written).toContain('"reasoningEfforts":{"off":"none","low":"low","high":"high","xhigh":"xhigh"}')
  expect(screen.getByRole('group', { name: `${en.modelReasoning} 1` }).textContent).toContain('none · low · high · xhigh')
  expect(screen.queryByRole('switch', { name: `${en.modelReasoning} 1` })).toBeNull()
  expect(storeCredential).not.toHaveBeenCalled()
})

it('refuses an incomplete model without writing settings or a credential', async () => {
  const { operations, writeSettings, storeCredential } = fixture(false)
  fill(operations)
  fireEvent.click(screen.getByRole('button', { name: en.create }))
  await screen.findByText(en.metadataMissing.replace('{models}', 'vision'))
  expect(writeSettings).not.toHaveBeenCalled()
  expect(storeCredential).not.toHaveBeenCalled()
})

it('replaces stale manual capacities while preserving unrelated model settings', async () => {
  const { operations } = fixture()
  const result = await resolveModelMetadata(operations, { settingsNs: 'llm-pi-ai', provider: 'personal' },
    [{ id: 'vision', contextWindow: 1000000, input: ['text'], name: 'My vision model', reasoningEfforts: false }], key => en[key])
  expect(result.models).toEqual([{ id: 'vision', contextWindow: 200000, maxTokens: 8000,
    input: ['text', 'image'], name: 'My vision model', reasoningEfforts: { off: 'none', low: 'low', high: 'high', xhigh: 'xhigh' } }])
})

it('maps only disclosed reasoning levels and distinguishes unsupported from unknown', () => {
  expect(discoveredReasoningEfforts(false)).toBe(false)
  expect(discoveredReasoningEfforts(undefined)).toBeUndefined()
  expect(discoveredReasoningEfforts(['none'])).toBeUndefined()
  expect(discoveredReasoningEfforts(['minimal', 'medium', 'max'])).toEqual({ minimal: 'minimal', medium: 'medium', max: 'max' })
})

it.each([
  [false, en.modelReasoningUnsupported],
  [undefined, en.modelReasoningUnknown],
] as const)('shows the fetched reasoning status without manual controls (%s)', async (reasoningLevels, label) => {
  const { operations, writeSettings, discoverModels } = fixture()
  discoverModels.mockResolvedValue({ kind: 'found', models: [{ id: 'vision', contextWindow: 200000,
    maxTokens: 8000, inputModalities: ['text'], ...reasoningLevels === undefined ? {} : { reasoningLevels } }] })
  fill(operations)
  fireEvent.click(screen.getByRole('button', { name: en.create }))
  await waitFor(() => { expect(writeSettings).toHaveBeenCalledTimes(1) })
  expect(screen.getByRole('group', { name: `${en.modelReasoning} 1` }).textContent).toContain(label)
  expect(screen.queryByRole('switch', { name: `${en.modelReasoning} 1` })).toBeNull()
})
