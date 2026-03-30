import FeedbackUI from './FeedbackUI'
import { requireViewerPageSession } from '@/lib/authz'

export default async function FeedbackPage() {
  await requireViewerPageSession()

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <FeedbackUI />
    </div>
  )
}
