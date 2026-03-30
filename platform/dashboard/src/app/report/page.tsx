import ReportUI from './ReportUI'
import { requireViewerPageSession } from '@/lib/authz'

export default async function ReportPage() {
  await requireViewerPageSession()

  return <ReportUI />
}
