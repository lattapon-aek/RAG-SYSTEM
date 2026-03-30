import type { Metadata } from 'next'
import './globals.css'
import { ChatDraftProvider } from './chat/ChatDraftContext'
import Sidebar from './Sidebar'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'RAG Dashboard',
  description: 'RAG System Monitoring & Administration Dashboard',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  const showSidebar = !!session?.user

  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen flex overflow-hidden">
        {showSidebar ? (
          <Sidebar
            user={{
              name: session.user.name,
              role: session.user.role,
            }}
          />
        ) : null}
        <main className={`flex-1 min-h-0 overflow-y-auto ${showSidebar ? 'ml-56' : ''}`}>
          <ChatDraftProvider>
            {children}
          </ChatDraftProvider>
        </main>
      </body>
    </html>
  )
}
