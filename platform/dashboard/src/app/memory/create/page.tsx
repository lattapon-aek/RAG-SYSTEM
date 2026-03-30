import { redirect } from 'next/navigation'
import { requireAdminPageSession } from '@/lib/authz'

export default async function CreateMemoryProfilePage() {
  await requireAdminPageSession()
  redirect('/memory-profiles')
}
