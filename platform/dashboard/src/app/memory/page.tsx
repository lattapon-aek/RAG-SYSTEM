import { Suspense } from 'react'
import MemoryUI from './MemoryUI'
import { requireOperatorPageSession } from '@/lib/authz'

export default async function MemoryPage() {
  await requireOperatorPageSession()

  return (
    <Suspense>
      <MemoryUI />
    </Suspense>
  )
}
