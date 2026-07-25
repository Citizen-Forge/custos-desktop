import { app, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import WebSocket from 'ws'
import type { ApiResult, ChatClosedEvent, ChatEvent, ChatEventEnvelope, PmEvent } from '../shared/types'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

interface StoredConfig {
  baseUrl: string | null
}

/**
 * All Custos networking lives here, in the main process, using plain Node
 * fetch/ws -- not the renderer's browser fetch/WebSocket. The renderer's
 * own origin (file:// in production, localhost:5173 in dev) is a
 * different site from wherever Custos is hosted, so a SameSite=Lax session
 * cookie set by /login would never be sent back on a renderer-initiated
 * cross-site fetch or WebSocket. Node's networking has no CORS/SameSite
 * concept at all, so the cookie is just tracked here and attached by hand
 * on every request instead of relying on browser cookie-jar semantics.
 */
class CustosClient {
  private baseUrl: string | null = null
  private sessionCookie: string | null = null
  // Kept in memory only (never written to disk) so the Settings webview
  // (its own real browser context, logged in independently) can be
  // auto-filled once instead of making the user log in twice. Gone on
  // app restart, same trust boundary as not storing it at all.
  private password: string | null = null
  private sockets = new Map<string, WebSocket>()
  private pmSocket: WebSocket | null = null

  async loadConfig(): Promise<StoredConfig> {
    try {
      const raw = await readFile(CONFIG_PATH, 'utf8')
      const parsed = JSON.parse(raw) as StoredConfig
      this.baseUrl = parsed.baseUrl ?? null
      return parsed
    } catch {
      return { baseUrl: null }
    }
  }

  async setBaseUrl(url: string): Promise<void> {
    this.baseUrl = url.replace(/\/+$/, '')
    this.sessionCookie = null
    this.password = null
    await mkdir(dirname(CONFIG_PATH), { recursive: true })
    await writeFile(CONFIG_PATH, JSON.stringify({ baseUrl: this.baseUrl }, null, 2), 'utf8')
  }

  getBaseUrl(): string | null {
    return this.baseUrl
  }

  isLoggedIn(): boolean {
    return !!this.sessionCookie
  }

  getPasswordForWebviewAutofill(): string | null {
    return this.password
  }

  async login(password: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.baseUrl) return { ok: false, error: 'no server configured' }
    try {
      const res = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const setCookie = res.headers.get('set-cookie')
      if (!res.ok || !setCookie) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        return { ok: false, error: body.error || `HTTP ${res.status}` }
      }
      this.sessionCookie = setCookie.split(';')[0]
      this.password = password
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  logout(): void {
    this.sessionCookie = null
    this.password = null
    for (const socket of this.sockets.values()) socket.close()
    this.sockets.clear()
    this.closePmSocket()
  }

  async api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    if (!this.baseUrl) return { ok: false, status: 0, data: null as T, error: 'no server configured' }
    if (!this.sessionCookie) return { ok: false, status: 401, data: null as T, error: 'not logged in' }
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: this.sessionCookie },
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
      const data = (await res.json().catch(() => null)) as T
      if (res.status === 401) this.sessionCookie = null
      if (!res.ok) {
        return { ok: false, status: res.status, data, error: (data as { error?: string } | null)?.error || `HTTP ${res.status}` }
      }
      return { ok: true, status: res.status, data }
    } catch (err) {
      return { ok: false, status: 0, data: null as T, error: (err as Error).message }
    }
  }

  // connectUrl's host comes from the server's own GATEWAY_PUBLIC_URL, which
  // is meant for a human clicking a link in a browser and may not be the
  // address this app actually reaches Custos through (e.g. a LAN IP while
  // GATEWAY_PUBLIC_URL points at a tunnel hostname that isn't even set up
  // yet). Only the token is taken from connectUrl; the host always comes
  // from this.baseUrl -- the address every other request already proved
  // reachable.
  private wsUrl(connectUrl: string): { url: string; token: string } {
    const token = new URL(connectUrl).searchParams.get('token') ?? ''
    const base = new URL(this.baseUrl!)
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    return { url: `${wsProtocol}//${base.host}/remote/ws?token=${encodeURIComponent(token)}`, token }
  }

  openChatSocket(chatId: string, connectUrl: string, window: BrowserWindow): void {
    this.closeChatSocket(chatId)
    if (!this.sessionCookie) return
    const { url } = this.wsUrl(connectUrl)
    const socket = new WebSocket(url, { headers: { cookie: this.sessionCookie } })

    socket.on('message', (raw) => {
      let event: ChatEvent
      try {
        event = JSON.parse(raw.toString())
      } catch {
        return
      }
      const envelope: ChatEventEnvelope = { chatId, event }
      window.webContents.send('chat:event', envelope)
    })
    socket.on('close', (code, reason) => {
      this.sockets.delete(chatId)
      const event: ChatClosedEvent = { chatId, reason: reason.toString() || `closed (${code})` }
      window.webContents.send('chat:closed', event)
    })
    socket.on('error', (err) => {
      const event: ChatClosedEvent = { chatId, reason: err.message }
      window.webContents.send('chat:closed', event)
    })

    this.sockets.set(chatId, socket)
  }

  sendUserMessage(chatId: string, text: string): void {
    const socket = this.sockets.get(chatId)
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'user_message', text }))
  }

  sendApproval(chatId: string, id: string, decision: 'allow' | 'deny'): void {
    const socket = this.sockets.get(chatId)
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'approval_response', id, decision }))
  }

  closeChatSocket(chatId: string): void {
    const socket = this.sockets.get(chatId)
    if (socket) {
      socket.close()
      this.sockets.delete(chatId)
    }
  }

  /**
   * Subscribes to one project's board/roadmap change notifications. Only
   * one is open at a time -- the renderer shows one project's tabs at a
   * time, and a stale subscription to a project the user navigated away
   * from would just cause pointless refetches.
   */
  openPmSocket(projectId: string, window: BrowserWindow): void {
    this.closePmSocket()
    if (!this.sessionCookie || !this.baseUrl) return
    const base = new URL(this.baseUrl)
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${wsProtocol}//${base.host}/admin/api/pm/ws?projectId=${encodeURIComponent(projectId)}`
    const socket = new WebSocket(url, { headers: { cookie: this.sessionCookie } })

    socket.on('message', (raw) => {
      try {
        window.webContents.send('pm:event', JSON.parse(raw.toString()) as PmEvent)
      } catch {
        // Ignore malformed frames rather than tearing down the subscription.
      }
    })
    socket.on('close', () => {
      if (this.pmSocket === socket) this.pmSocket = null
    })
    socket.on('error', () => {
      if (this.pmSocket === socket) this.pmSocket = null
    })

    this.pmSocket = socket
  }

  closePmSocket(): void {
    this.pmSocket?.close()
    this.pmSocket = null
  }
}

export const custosClient = new CustosClient()
