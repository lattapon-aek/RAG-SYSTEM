import JobQueueUI from './JobQueueUI'
import { requireOperatorPageSession } from '@/lib/authz'

export default async function JobsPage() {
  await requireOperatorPageSession()

  return <JobQueueUI />
}
