import { requireOperatorPageSession } from '@/lib/authz'
import GraphUI from './GraphUI'

export default async function GraphPage() {
  await requireOperatorPageSession()
  return <GraphUI />
}
