import { getDashboardPgPool } from '@/lib/db'

export async function recordDashboardAdminAction(args: {
  adminUserId: string | null | undefined
  action: string
  resourceType: string
  targetId: string
  beforeValue?: Record<string, unknown> | null
  afterValue?: Record<string, unknown> | null
  notes?: string | null
}) {
  if (!args.adminUserId) {
    return
  }

  try {
    const pool = getDashboardPgPool()
    await pool.query(
      `INSERT INTO admin_action_log
         (admin_user_id, action, resource_type, target_id, before_value, after_value, notes)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [
        args.adminUserId,
        args.action,
        args.resourceType,
        args.targetId,
        args.beforeValue ? JSON.stringify(args.beforeValue) : null,
        args.afterValue ? JSON.stringify(args.afterValue) : null,
        args.notes ?? null,
      ],
    )
  } catch (error) {
    console.error('Failed to record dashboard admin action:', error)
  }
}
