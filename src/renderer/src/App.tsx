import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Shell from './components/Shell'

type Phase = 'loading' | 'setup' | 'handoff' | 'shell'

/**
 * The desktop shell answers the two questions that have to be settled
 * before there is anything to load — which Custos instance, and the
 * password for it — and then hands the window to that server's own copy of
 * this application at /app.
 *
 * The two builds are the same component tree; only the implementation of
 * `window.custos` differs. Served from the server's origin the app can use
 * ordinary fetch and WebSocket with the session cookie, which is exactly
 * the thing this process exists to work around when it can't.
 *
 * If the handoff fails (an older server with no /app, or an unreachable
 * one) it falls back to rendering the bundled Shell over IPC, so a version
 * mismatch degrades rather than breaks.
 */
export default function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [handoffError, setHandoffError] = useState<string | null>(null)

  async function handOffToServer(): Promise<void> {
    setPhase('handoff')
    const result = await window.custos.openWebUi()
    if (!result.ok) {
      setHandoffError(result.error ?? 'could not open the hosted UI')
      setPhase('shell')
    }
    // On success the window navigates away; this tree is discarded.
  }

  useEffect(() => {
    window.custos.getConfig().then((status) => {
      if (status.baseUrl && status.loggedIn) void handOffToServer()
      else setPhase('setup')
    })
  }, [])

  if (phase === 'loading') return <div className="empty-state">Loading…</div>
  if (phase === 'handoff') return <div className="empty-state">Opening Custos…</div>
  if (phase === 'setup') return <SetupScreen onConnected={handOffToServer} />
  return (
    <>
      {handoffError && (
        <div className="callout" style={{ margin: 12 }}>
          Couldn&rsquo;t open the server&rsquo;s hosted interface ({handoffError}) — running the built-in one instead. Updating Custos
          will fix this.
        </div>
      )}
      <Shell onSessionExpired={() => setPhase('setup')} />
    </>
  )
}
