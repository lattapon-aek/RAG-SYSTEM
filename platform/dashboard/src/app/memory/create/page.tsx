import { requireAdminPageSession } from '@/lib/authz'
import CreateMemoryProfileUI from './CreateMemoryProfileUI'

export default async function CreateMemoryProfilePage() {
  await requireAdminPageSession()
  return <CreateMemoryProfileUI />
}
