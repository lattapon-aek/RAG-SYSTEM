import { Suspense } from 'react'
import { requireAdminPageSession } from '@/lib/authz'
import MemoryProfilesUI from './MemoryProfilesUI'

export default async function MemoryProfilesPage() {
  await requireAdminPageSession()

  return (
    <Suspense>
      <MemoryProfilesUI />
    </Suspense>
  )
}
