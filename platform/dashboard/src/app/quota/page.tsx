import QuotaUI from './QuotaUI'
import { requireOperatorPageSession } from '@/lib/authz'

export default async function QuotaPage() {
  await requireOperatorPageSession()

  return <QuotaUI />
}
