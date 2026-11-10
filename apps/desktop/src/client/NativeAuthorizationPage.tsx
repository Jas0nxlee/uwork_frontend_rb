/** Organization selection and safe status surrounding the Main-owned QR browser surface. */
import { useEffect, useRef, useState } from 'react'
import type { NativeAuthorizationState } from '@deepseek-ai/dsh-native-authorization/types'
import type { NativeAuthorizationApi } from '../native-authorization-api.ts'
import { nativeAuthorizationMessages } from '../native-authorization-locale.ts'

/**
 * @param props - safe native API, initial Host projection and desktop language.
 * @returns native entry controls; no authorization URL is rendered.
 */
export function NativeAuthorizationPage({ api, initial, locale }: {
  api: NativeAuthorizationApi
  initial: NativeAuthorizationState
  locale: string
}) {
  const m = nativeAuthorizationMessages(locale)
  const [state, setState] = useState(initial)
  const [choice, setChoice] = useState(initial.selectedChoiceId ?? initial.choices[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const placeholder = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const attempt = state.attempt
  const waiting = state.status === 'pending' && attempt !== undefined
  useEffect(() => {
    document.documentElement.lang = locale.replace('_', '-')
    document.title = m.title
    mounted.current = true
    return () => { mounted.current = false }
  }, [locale, m.title])
  useEffect(() => {
    if (attempt === undefined || !waiting) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await api.poll(attempt.id)
        if (!disposed) setState(next)
      } catch (_error: unknown) {
        try {
          const next = await api.state()
          if (!disposed && next !== null) setState(next)
        } catch (_unavailable: unknown) { /* Keep the current attempt cancellable while Host recovers. */ }
        if (!disposed) setFailed(true)
      }
      if (!disposed) timer = setTimeout(() => { void poll() }, 2000)
    }
    timer = setTimeout(() => { void poll() }, 2000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [api, attempt?.id, waiting])
  async function start() {
    const element = placeholder.current
    if (busy || element === null || choice === '') return
    setBusy(true); setFailed(false)
    const rectangle = element.getBoundingClientRect()
    try {
      const next = await api.start(choice, { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height })
      if (mounted.current) setState(next)
    } catch (_error: unknown) { if (mounted.current) setFailed(true) }
    finally { if (mounted.current) setBusy(false) }
  }
  async function cancel() {
    if (busy || attempt === undefined) return
    setBusy(true)
    try { const next = await api.cancel(attempt.id); if (mounted.current) { setState(next); setFailed(false) } }
    catch (_error: unknown) { if (mounted.current) setFailed(true) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <>
    <div className="titlebar" aria-hidden="true" />
    <main className="native-authorization" aria-labelledby="native-authorization-title" aria-busy={busy}>
      <h1 id="native-authorization-title">{m.title}</h1>
      <label htmlFor="native-authorization-choice">{m.organization}</label>
      <select id="native-authorization-choice" value={choice} disabled={waiting || busy} onChange={(event) => { setChoice(event.target.value) }}>
        {state.choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <p role="status">{waiting ? m.waiting : busy ? m.loading : '\u00a0'}</p>
      <div ref={placeholder} className="native-authorization-browser" aria-hidden="true" />
      <p role="alert" className="key-error">{state.error === 'expired' ? m.expired : failed || state.error === 'failed' ? m.failed : '\u00a0'}</p>
      <div className="native-authorization-actions">
        {waiting ? <button className="secondary" type="button" disabled={busy} onClick={() => { void cancel() }}>{m.cancel}</button>
          : <button className="primary" type="button" disabled={busy || choice === ''} onClick={() => { void start() }}>{failed || state.error ? m.retry : m.start}</button>}
      </div>
    </main>
  </>
}
