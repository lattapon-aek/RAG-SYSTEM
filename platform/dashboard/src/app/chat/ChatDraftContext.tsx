'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'chat_draft'

interface ChatDraftContextValue {
  draft: string
  setDraft: (v: string) => void
}

const ChatDraftContext = createContext<ChatDraftContextValue>({ draft: '', setDraft: () => {} })

export function ChatDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraftState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })

  const setDraft = useCallback((v: string) => {
    setDraftState(v)
    try {
      if (v) {
        localStorage.setItem(STORAGE_KEY, v)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {}
  }, [])

  return (
    <ChatDraftContext.Provider value={{ draft, setDraft }}>
      {children}
    </ChatDraftContext.Provider>
  )
}

export function useChatDraft() {
  return useContext(ChatDraftContext)
}
