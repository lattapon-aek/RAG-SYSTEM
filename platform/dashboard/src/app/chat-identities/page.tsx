import { requireAdminPageSession } from '@/lib/authz'
import ChatIdentitiesUI from './ChatIdentitiesUI'

export default async function ChatIdentitiesPage() {
  await requireAdminPageSession()
  return <ChatIdentitiesUI />
}
