/**
 * Module-level singleton — survives React unmount/remount during client-side navigation.
 * Stream continues in background; component re-subscribes on remount to receive updates.
 */

export interface Citation {
  chunk_id: string
  document_id: string
  filename: string
  text_snippet: string
  score: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  request_id?: string
  citations?: Citation[]
  grounding_score?: number
  low_confidence?: boolean
  from_cache?: boolean
  latency_ms?: number
  rewritten_query?: string | null
  status?: 'retrieving' | 'generating' | 'done' | 'error'
  feedback?: 'up' | 'down'
}

type MessagesUpdater = (prev: Message[]) => Message[]
type Subscriber = (updater: MessagesUpdater) => void
type LoadingSubscriber = (v: boolean) => void

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  savedAt: string
}

const DRAFT_KEY = 'chat_draft'
const HISTORY_KEY = 'chat_history'
const MAX_SESSIONS = 20

let _draft = ''
let _messages: Message[] = []
let _loading = false
let _initialized = false
let _subscriber: Subscriber | null = null
let _loadingSubscriber: LoadingSubscriber | null = null

function init() {
  if (_initialized) return
  _initialized = true
  try { _draft = localStorage.getItem(DRAFT_KEY) ?? '' } catch {}
}

export const chatStore = {
  // --- Draft ---
  getDraft(): string {
    if (typeof window !== 'undefined') init()
    return _draft
  },
  setDraft(v: string) {
    _draft = v
    try {
      if (v) localStorage.setItem(DRAFT_KEY, v)
      else localStorage.removeItem(DRAFT_KEY)
    } catch {}
  },

  // --- Messages ---
  getMessages(): Message[] { return _messages },

  /** Update messages in store AND push to current component via subscriber */
  updateMessages(updater: MessagesUpdater) {
    _messages = updater(_messages)
    _subscriber?.(updater)
  },

  setMessages(msgs: Message[]) {
    _messages = msgs
    _subscriber?.(() => msgs)
  },

  // --- Loading flag (so remounted component knows stream is in progress) ---
  getLoading(): boolean { return _loading },
  setLoading(v: boolean) {
    _loading = v
    _loadingSubscriber?.(v)
  },

  // --- Subscribers ---
  subscribe(fn: Subscriber | null) { _subscriber = fn },
  subscribeLoading(fn: LoadingSubscriber | null) { _loadingSubscriber = fn },

  // --- Session history ---
  getSessions(): ChatSession[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      return raw ? (JSON.parse(raw) as ChatSession[]) : []
    } catch { return [] }
  },

  saveSession() {
    const msgs = _messages.filter((m) => m.status !== 'retrieving' && m.status !== 'generating')
    if (msgs.length === 0) return
    const firstUser = msgs.find((m) => m.role === 'user')
    const title = firstUser
      ? firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '…' : '')
      : 'Chat session'
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title,
      messages: msgs,
      savedAt: new Date().toISOString(),
    }
    try {
      const prev = chatStore.getSessions()
      const updated = [session, ...prev].slice(0, MAX_SESSIONS)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
    } catch {}
    return session
  },

  deleteSession(id: string) {
    try {
      const prev = chatStore.getSessions()
      localStorage.setItem(HISTORY_KEY, JSON.stringify(prev.filter((s) => s.id !== id)))
    } catch {}
  },
}
