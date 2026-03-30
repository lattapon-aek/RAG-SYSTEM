import { requireAdminPageSession } from '@/lib/authz'
import SettingsUI from './SettingsUI'

export default async function SettingsPage() {
  await requireAdminPageSession()
  return <SettingsUI />
}
