import { Suspense } from 'react'
import { getAdminActionLog, getAuditLog } from '@/lib/api'
import type { AdminConfigAuditLogEntry, AuditLogEntry } from '@/types'
import AuditLogView from './AuditLogView'
import AdminActionLogView from './AdminActionLogView'
import { requireAdminPageSession } from '@/lib/authz'

async function AuditLogContent() {
  let entries: AuditLogEntry[] = []
  let adminEntries: AdminConfigAuditLogEntry[] = []
  let error: string | null = null

  try {
    entries = await getAuditLog(500)
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load audit log'
  }

  try {
    adminEntries = await getAdminActionLog(500)
  } catch (e) {
    error = error ?? (e instanceof Error ? e.message : 'Failed to load admin action log')
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-400 text-sm">
        {error}
      </div>
    )
  }

  return (
    <>
      <AuditLogView entries={entries} />
      <AdminActionLogView entries={adminEntries} />
    </>
  )
}

export default async function AuditLogPage() {
  await requireAdminPageSession()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="text-sm text-gray-400 mt-1">
          Review approval decisions and critical admin actions across the dashboard
        </p>
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="text-gray-400 text-sm">Loading audit log…</div></div>}>
        <AuditLogContent />
      </Suspense>
    </div>
  )
}
