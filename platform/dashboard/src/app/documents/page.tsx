import DocumentsUI from './DocumentsUI'
import { requireOperatorPageSession } from '@/lib/authz'

export default async function DocumentsPage() {
  await requireOperatorPageSession()

  return <DocumentsUI />
}
