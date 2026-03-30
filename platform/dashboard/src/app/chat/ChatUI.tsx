'use client'

import { useState, useRef, useEffect } from 'react'
import { chatStore, type Message, type ChatSession } from './draftStore'

interface Citation {
  chunk_id: string
  document_id: string
  filename: string
  text_snippet: string
  score: number
}

interface QueryParams {
  namespace: string
  client_id: string
  user_id: string
  top_k: number
  top_n_rerank: number
  max_context_tokens: number
  use_cache: boolean
  force_refresh: boolean
  use_memory: boolean
  use_hyde: boolean
  use_rewrite: boolean
  use_decompose: boolean
  use_graph: boolean
}

const DEFAULT_PARAMS: QueryParams = {
  namespace: 'default',
  client_id: '',
  user_id: '',
  top_k: 10,
  top_n_rerank: 5,
  max_context_tokens: 4096,
  use_cache: true,
  force_refresh: false,
  use_memory: false,
  use_hyde: false,
  use_rewrite: false,
  use_decompose: false,
  use_graph: true,
}

const PARAM_DOCS: Record<string, string> = {
  namespace: 'Namespace(s) to query — comma-separated for multi-namespace (e.g. "hr, legal")',
  client_id: 'Client ID for quota and rate-limit tracking',
  user_id: 'User ID for memory context',
  top_k: 'Number of chunks to retrieve from vector store',
  top_n_rerank: 'Number of results after reranking',
  max_context_tokens: 'Max tokens to pass to LLM as context',
  use_cache: 'Use semantic cache (skip if similar query cached)',
  force_refresh: 'Bypass cache even if hit exists',
  use_memory: 'Inject user long-term memory into context',
  use_hyde: 'HyDE: generate hypothetical answer to improve embedding',
  use_rewrite: 'Rewrite query with LLM before retrieval',
  use_decompose: 'Decompose complex query into sub-queries',
  use_graph: 'Augment context with Neo4j graph entities',
}

function Toggle({ checked, onChange, label, tip }: { checked: boolean; onChange: (v: boolean) => void; label: string; tip?: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      title={tip}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border w-full ${
        checked
          ? 'bg-purple-600/20 border-purple-600/50 text-purple-300'
          : 'bg-gray-800/60 border-gray-700/50 text-gray-500 hover:border-gray-600 hover:text-gray-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${checked ? 'bg-purple-400' : 'bg-gray-600'}`} />
      {label}
    </button>
  )
}

function NumStepper({ value, onChange, min, max, step = 1, tip }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; tip?: string
}) {
  return (
    <div className="flex items-center gap-1" title={tip}>
      <button onClick={() => onChange(Math.max(min, value - step))}
        className="w-6 h-6 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white text-xs flex items-center justify-center transition-colors">−</button>
      <input
        type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-12 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white text-center outline-none focus:border-purple-600"
      />
      <button onClick={() => onChange(Math.min(max, value + step))}
        className="w-6 h-6 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white text-xs flex items-center justify-center transition-colors">+</button>
    </div>
  )
}

export default function ChatUI() {
  const [input, setInputState] = useState('')
  const [messages, setMessagesState] = useState<Message[]>([])
  const [loading, setLoadingState] = useState(false)
  const [params, setParams] = useState<QueryParams>(DEFAULT_PARAMS)
  const [showPayload, setShowPayload] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function setInput(v: string) { setInputState(v); chatStore.setDraft(v) }
  function setLoading(v: boolean) { setLoadingState(v); chatStore.setLoading(v) }

  useEffect(() => {
    setInputState(chatStore.getDraft())
    setMessagesState(chatStore.getMessages())
    setLoadingState(chatStore.getLoading())
    setSessions(chatStore.getSessions())
    chatStore.subscribe((updater) => setMessagesState(updater))
    chatStore.subscribeLoading((v) => setLoadingState(v))
    return () => {
      chatStore.subscribe(null)
      chatStore.subscribeLoading(null)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function buildPayload(query: string) {
    const p: Record<string, unknown> = { query }
    if (params.namespace) {
      const nsList = params.namespace.split(',').map((s) => s.trim()).filter(Boolean)
      if (nsList.length > 1) p.namespaces = nsList
      else if (nsList.length === 1) p.namespace = nsList[0]
    }
    if (params.client_id) p.client_id = params.client_id
    if (params.user_id) p.user_id = params.user_id
    p.top_k = params.top_k
    p.top_n_rerank = params.top_n_rerank
    p.max_context_tokens = params.max_context_tokens
    p.use_cache = params.use_cache
    p.force_refresh = params.force_refresh
    p.use_memory = params.use_memory
    p.use_hyde = params.use_hyde
    p.use_rewrite = params.use_rewrite
    p.use_decompose = params.use_decompose
    p.use_graph = params.use_graph
    return p
  }

  async function send() {
    const query = input.trim()
    if (!query || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: query }
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', status: 'retrieving' }

    chatStore.updateMessages((prev) => [...prev, userMsg, assistantMsg])
    setMessagesState(chatStore.getMessages())
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(query)),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Connection failed' }))
        chatStore.updateMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: err.error ?? 'Request failed', status: 'error' } : m)
        )
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try { handleEvent(assistantId, JSON.parse(line.slice(6))) } catch {}
        }
      }
    } catch {
      chatStore.updateMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: 'Connection error', status: 'error' } : m)
      )
    } finally {
      setLoading(false)
    }
  }

  function handleEvent(id: string, event: Record<string, unknown>) {
    if (event.type === 'token') {
      chatStore.updateMessages((prev) =>
        prev.map((m) => m.id === id ? { ...m, content: m.content + (event.content as string), status: 'generating' } : m)
      )
    } else if (event.type === 'citations') {
      chatStore.updateMessages((prev) =>
        prev.map((m) => m.id === id ? { ...m, citations: event.citations as Citation[], grounding_score: event.grounding_score as number, low_confidence: event.low_confidence as boolean } : m)
      )
    } else if (event.type === 'done') {
      chatStore.updateMessages((prev) =>
        prev.map((m) => m.id === id ? { ...m, status: 'done', from_cache: event.from_cache as boolean, latency_ms: event.total_latency_ms as number, rewritten_query: event.rewritten_query as string | null, request_id: event.request_id as string | undefined } : m)
      )
    } else if (event.type === 'error') {
      chatStore.updateMessages((prev) =>
        prev.map((m) => m.id === id ? { ...m, content: event.message as string, status: 'error' } : m)
      )
    }
  }

  const [categoryPickerFor, setCategoryPickerFor] = useState<{msgId: string; requestId: string} | null>(null)

  const FEEDBACK_CATEGORIES = [
    { value: 'wrong_answer',  label: 'Wrong answer',  emoji: '❌' },
    { value: 'incomplete',    label: 'Incomplete',     emoji: '📝' },
    { value: 'off_topic',     label: 'Off-topic',      emoji: '🔀' },
    { value: 'hallucination', label: 'Hallucination',  emoji: '🤖' },
    { value: 'general',       label: 'Other',          emoji: '❓' },
  ]

  async function sendFeedback(msgId: string, requestId: string, score: number, category: string = 'general') {
    chatStore.updateMessages((prev) =>
      prev.map((m) => m.id === msgId ? { ...m, feedback: score >= 0.5 ? 'up' : 'down' } : m)
    )
    setCategoryPickerFor(null)
    const msgs = chatStore.getMessages()
    const idx = msgs.findIndex((m) => m.id === msgId)
    const queryText = idx > 0 ? msgs[idx - 1].content : undefined
    const namespace = params.namespace.trim() || 'default'
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        feedback_score: score,
        query_text: queryText,
        category,
        namespace,
        user_id: params.user_id || undefined,
        source_type: 'chat',
        source_id: msgId,
      }),
    }).catch(() => {})
  }

  function handleThumbDown(msgId: string, requestId: string) {
    setCategoryPickerFor({ msgId, requestId })
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function saveAndClear() {
    if (messages.length > 0) {
      chatStore.saveSession()
      setSessions(chatStore.getSessions())
    }
    chatStore.setMessages([])
    setMessagesState([])
  }

  function loadSession(session: ChatSession) {
    if (messages.length > 0) chatStore.saveSession()
    chatStore.setMessages(session.messages)
    setMessagesState(session.messages)
    setSessions(chatStore.getSessions())
    setShowHistory(false)
  }

  function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    chatStore.deleteSession(id)
    setSessions(chatStore.getSessions())
  }

  const payload = buildPayload(input || '(your query)')

  return (
    <div className="flex h-full">
      {/* ── Left: Parameter Panel ── */}
      <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-900/40 overflow-y-auto">
        {/* History */}
        <div className="border-b border-gray-800">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
          >
            <span className="font-semibold uppercase tracking-wider">History {sessions.length > 0 && `(${sessions.length})`}</span>
            <svg className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showHistory && (
            <div className="max-h-56 overflow-y-auto divide-y divide-gray-800/60">
              {sessions.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-600">No saved sessions yet</p>
              ) : sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadSession(s)}
                  className="w-full flex items-start justify-between gap-2 px-4 py-2.5 hover:bg-gray-800/60 text-left group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-300 truncate">{s.title}</p>
                    <p className="text-[10px] text-gray-600 mt-0.5">{new Date(s.savedAt).toLocaleString()} · {s.messages.length} msg{s.messages.length !== 1 ? 's' : ''}</p>
                  </div>
                  <span
                    onClick={(e) => deleteSession(s.id, e)}
                    className="text-gray-700 hover:text-red-400 transition-colors text-[10px] mt-0.5 shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    ✕
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Parameters</span>
          <button onClick={() => setParams(DEFAULT_PARAMS)} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">Reset</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Context */}
          <div className="px-4 pt-3 pb-2 space-y-2">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Context</p>
            <div>
              <label className="text-[10px] text-gray-600 mb-1 block">Namespace(s)</label>
              <input
                value={params.namespace}
                onChange={(e) => setParams((p) => ({ ...p, namespace: e.target.value }))}
                title={PARAM_DOCS.namespace}
                placeholder="default  or  hr, legal"
                className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono placeholder-gray-700 transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">User ID</label>
                <input
                  value={params.user_id}
                  onChange={(e) => setParams((p) => ({ ...p, user_id: e.target.value }))}
                  placeholder="optional"
                  title={PARAM_DOCS.user_id}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none placeholder-gray-700 transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Client ID</label>
                <input
                  value={params.client_id}
                  onChange={(e) => setParams((p) => ({ ...p, client_id: e.target.value }))}
                  placeholder="optional"
                  title={PARAM_DOCS.client_id}
                  className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none placeholder-gray-700 transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-800 mx-4" />

          {/* Retrieval numbers */}
          <div className="px-4 pt-3 pb-2 space-y-2.5">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Retrieval</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Retrieve</p>
                <p className="text-[10px] text-gray-600">chunks from vector store</p>
              </div>
              <NumStepper value={params.top_k} onChange={(v) => setParams((p) => ({ ...p, top_k: v }))} min={1} max={50} tip={PARAM_DOCS.top_k} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Rerank to</p>
                <p className="text-[10px] text-gray-600">results after reranking</p>
              </div>
              <NumStepper value={params.top_n_rerank} onChange={(v) => setParams((p) => ({ ...p, top_n_rerank: v }))} min={1} max={20} tip={PARAM_DOCS.top_n_rerank} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Context tokens</p>
                <p className="text-[10px] text-gray-600">max passed to LLM</p>
              </div>
              <NumStepper value={params.max_context_tokens} onChange={(v) => setParams((p) => ({ ...p, max_context_tokens: v }))} min={512} max={32768} step={512} tip={PARAM_DOCS.max_context_tokens} />
            </div>
          </div>

          <div className="h-px bg-gray-800 mx-4" />

          {/* Feature toggles */}
          <div className="px-4 pt-3 pb-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Features</p>
            <div className="grid grid-cols-2 gap-1.5">
              <Toggle checked={params.use_graph}    onChange={(v) => setParams((p) => ({ ...p, use_graph: v }))}    label="Graph"    tip={PARAM_DOCS.use_graph} />
              <Toggle checked={params.use_cache}    onChange={(v) => setParams((p) => ({ ...p, use_cache: v }))}    label="Cache"    tip={PARAM_DOCS.use_cache} />
              <Toggle checked={params.use_memory}   onChange={(v) => setParams((p) => ({ ...p, use_memory: v }))}   label="Memory"   tip={PARAM_DOCS.use_memory} />
              <Toggle checked={params.use_rewrite}  onChange={(v) => setParams((p) => ({ ...p, use_rewrite: v }))}  label="Rewrite"  tip={PARAM_DOCS.use_rewrite} />
              <Toggle checked={params.use_hyde}     onChange={(v) => setParams((p) => ({ ...p, use_hyde: v }))}     label="HyDE"     tip={PARAM_DOCS.use_hyde} />
              <Toggle checked={params.use_decompose}onChange={(v) => setParams((p) => ({ ...p, use_decompose: v }))}label="Decompose" tip={PARAM_DOCS.use_decompose} />
            </div>
            <Toggle checked={params.force_refresh} onChange={(v) => setParams((p) => ({ ...p, force_refresh: v }))} label="Force Refresh (bypass cache)" tip={PARAM_DOCS.force_refresh} />
          </div>
        </div>

        {/* Payload preview */}
        <div className="border-t border-gray-800">
          <button
            onClick={() => setShowPayload((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
          >
            <span className="font-mono">JSON Payload</span>
            <svg className={`w-3 h-3 transition-transform ${showPayload ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showPayload && (
            <pre className="px-4 pb-4 text-xs text-green-400 font-mono overflow-x-auto whitespace-pre-wrap bg-gray-950/50">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* ── Right: Chat ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-full bg-purple-900/40 border border-purple-700/50 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <p className="text-gray-400 text-sm">Configure parameters on the left, then ask a question</p>
              <p className="text-gray-600 text-xs mt-1">Enter to send · Shift+Enter for newline</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-purple-900/40 border border-purple-700/50 flex items-center justify-center flex-shrink-0 mt-1">
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
              )}
              <div className={`max-w-2xl ${msg.role === 'user' ? 'order-first' : ''}`}>
                {msg.role === 'user' ? (
                  <div className="bg-purple-600/20 border border-purple-700/40 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-white">
                    {msg.content}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-100 leading-relaxed min-w-[120px]">
                      {msg.status === 'retrieving' && !msg.content && (
                        <span className="flex items-center gap-2 text-gray-400">
                          <span className="flex gap-1">
                            {[0, 150, 300].map((d) => (
                              <span key={d} className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                            ))}
                          </span>
                          Retrieving…
                        </span>
                      )}
                      {msg.content && <span className="whitespace-pre-wrap">{msg.content}</span>}
                      {msg.status === 'generating' && (
                        <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5 rounded-sm" />
                      )}
                    </div>

                    {/* Meta */}
                    {msg.status === 'done' && (
                      <div className="flex items-center gap-3 px-1 flex-wrap">
                        {msg.from_cache && (
                          <span className="text-xs text-blue-400 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Cached
                          </span>
                        )}
                        {msg.latency_ms != null && (
                          <span className="text-xs text-gray-500">{Math.round(msg.latency_ms)}ms</span>
                        )}
                        {msg.grounding_score != null && (
                          <span className={`text-xs ${msg.low_confidence ? 'text-yellow-400' : 'text-green-400'}`}>
                            Grounding {Math.round(msg.grounding_score * 100)}%
                          </span>
                        )}
                        {msg.rewritten_query && (
                          <span className="text-xs text-gray-500 italic">
                            Rewritten: &quot;{msg.rewritten_query}&quot;
                          </span>
                        )}
                        {/* Feedback buttons */}
                        {msg.request_id && (
                          <div className="flex items-center gap-1 ml-auto relative">
                            <button
                              onClick={() => sendFeedback(msg.id, msg.request_id!, 1.0, 'general')}
                              title="Good answer"
                              className={`p-1 rounded transition-colors ${msg.feedback === 'up' ? 'text-green-400' : 'text-gray-600 hover:text-green-400'}`}
                            >
                              <svg className="w-3.5 h-3.5" fill={msg.feedback === 'up' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                              </svg>
                            </button>
                            <button
                              onClick={() => msg.feedback === 'down' ? null : handleThumbDown(msg.id, msg.request_id!)}
                              title="Bad answer — select reason"
                              className={`p-1 rounded transition-colors ${msg.feedback === 'down' ? 'text-red-400' : 'text-gray-600 hover:text-red-400'}`}
                            >
                              <svg className="w-3.5 h-3.5" fill={msg.feedback === 'down' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                              </svg>
                            </button>
                            {/* Category picker popup */}
                            {categoryPickerFor?.msgId === msg.id && (
                              <div className="absolute bottom-8 right-0 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 min-w-[160px]">
                                <p className="text-[9px] text-gray-500 uppercase tracking-widest px-2 pb-1.5">Why was this bad?</p>
                                {FEEDBACK_CATEGORIES.map((cat) => (
                                  <button
                                    key={cat.value}
                                    onClick={() => sendFeedback(msg.id, msg.request_id!, 0.0, cat.value)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-300 hover:bg-gray-800 hover:text-white transition-colors text-left"
                                  >
                                    <span>{cat.emoji}</span>
                                    <span>{cat.label}</span>
                                  </button>
                                ))}
                                <button
                                  onClick={() => setCategoryPickerFor(null)}
                                  className="w-full mt-1 px-2 py-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors text-center border-t border-gray-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-300 px-1 flex items-center gap-1 select-none">
                          <svg className="w-3 h-3 group-open:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          {msg.citations.length} source{msg.citations.length > 1 ? 's' : ''}
                        </summary>
                        <div className="mt-2 space-y-2 pl-1">
                          {msg.citations.map((c, i) => (
                            <div key={c.chunk_id} className="bg-gray-900/60 border border-gray-700/40 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-xs text-gray-400 font-medium truncate">[{i + 1}] {c.filename}</span>
                                <span className="text-xs text-gray-500 flex-shrink-0">{(c.score * 100).toFixed(0)}%</span>
                              </div>
                              <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">{c.text_snippet}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {msg.status === 'error' && (
                      <p className="text-xs text-red-400 px-1">{msg.content}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-800 p-4">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask a question…"
              rows={2}
              disabled={loading}
              className="flex-1 bg-gray-800 border border-gray-700 focus:border-purple-600 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none outline-none transition-colors disabled:opacity-50"
            />
            <div className="flex flex-col gap-2 flex-shrink-0">
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className="w-10 h-10 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors"
              >
                {loading ? (
                  <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
              {messages.length > 0 && (
                <button
                  onClick={saveAndClear}
                  className="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-xl flex items-center justify-center transition-colors"
                  title="Save & clear chat"
                >
                  <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
