import { requireAdminPageSession } from '@/lib/authz'
import ApiKeysUI from './ApiKeysUI'

export default async function ApiKeysPage() {
  await requireAdminPageSession()

  return <ApiKeysUI />
}
