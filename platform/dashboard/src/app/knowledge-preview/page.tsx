import { requireOperatorPageSession } from '@/lib/authz'
import KnowledgePreviewUI from './KnowledgePreviewUI'

export default async function KnowledgePreviewPage() {
  await requireOperatorPageSession()
  return <KnowledgePreviewUI />
}
