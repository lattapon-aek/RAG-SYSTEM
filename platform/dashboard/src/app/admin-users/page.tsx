import { requireAdminPageSession } from '@/lib/authz'
import AdminUsersUI from './AdminUsersUI'

export default async function AdminUsersPage() {
  await requireAdminPageSession()

  return <AdminUsersUI />
}
