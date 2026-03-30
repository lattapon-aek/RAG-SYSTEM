import PlaygroundUI from './PlaygroundUI'
import { requireOperatorPageSession } from '@/lib/authz'

export default async function PlaygroundPage() {
  await requireOperatorPageSession()

  return (
    <div className="flex flex-col h-screen">
      <PlaygroundUI />
    </div>
  )
}
