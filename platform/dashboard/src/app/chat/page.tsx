import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import ChatUI from './ChatUI'

export default async function ChatPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <div className="flex flex-col h-screen">
      <div className="px-8 pt-8 pb-4 border-b border-gray-800 flex-shrink-0">
        <h1 className="text-2xl font-bold text-white">Chat</h1>
        <p className="text-sm text-gray-400 mt-1">
          Query the knowledge base with streaming responses and optionally prefill a saved chat identity
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <ChatUI />
      </div>
    </div>
  )
}
