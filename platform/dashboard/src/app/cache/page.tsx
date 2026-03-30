import CacheUI from './CacheUI'
import { requireOperatorPageSession } from '@/lib/authz'

export default async function CachePage() {
  await requireOperatorPageSession()

  return <CacheUI />
}
