import EvaluationUI from './EvaluationUI'
import { requireViewerPageSession } from '@/lib/authz'

export default async function EvaluationPage() {
  await requireViewerPageSession()

  return <EvaluationUI />
}
