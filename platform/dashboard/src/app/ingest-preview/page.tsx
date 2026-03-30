import { requireOperatorPageSession } from '@/lib/authz'
import IngestPreviewUI from './IngestPreviewUI'

export default async function IngestPreviewPage() {
  await requireOperatorPageSession()
  return <IngestPreviewUI />
}
