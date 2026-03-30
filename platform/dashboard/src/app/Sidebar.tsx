'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import LogoutButton from './LogoutButton'
import type { DashboardRole } from '@/lib/authz'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  minRole?: DashboardRole
}

interface NavGroup {
  label: string
  items: NavItem[]
}

interface SidebarProps {
  user?: {
    name: string
    role: DashboardRole
  } | null
}

const ROLE_RANK: Record<DashboardRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
}

interface RoleAwareNavGroup extends NavGroup {
  minRole?: DashboardRole
}

const NAV_GROUPS: RoleAwareNavGroup[] = [
  {
    label: 'Overview',
    minRole: 'viewer',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        minRole: 'viewer',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
    ],
  },
  {
    // Chat + Playground — ทั้งคู่คือ "ใช้งาน" ระบบโดยตรง
    label: 'Interact',
    minRole: 'viewer',
    items: [
      {
        href: '/chat',
        label: 'Chat',
        minRole: 'viewer',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        ),
      },
      {
        href: '/playground',
        label: 'Playground',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        ),
      },
    ],
  },
  {
    // จัดการ knowledge base — ingest, browse, feedback
    label: 'Knowledge',
    minRole: 'operator',
    items: [
      {
        href: '/namespaces',
        label: 'Namespaces',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <ellipse cx="12" cy="5" rx="9" ry="3" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3" />
          </svg>
        ),
      },
      {
        href: '/documents',
        label: 'Documents',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        href: '/jobs',
        label: 'Ingestion Jobs',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        ),
      },
      {
        href: '/feedback',
        label: 'Feedback',
        minRole: 'viewer',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
          </svg>
        ),
      },
      {
        href: '/graph',
        label: 'Graph',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="2" strokeWidth={2} />
            <circle cx="19" cy="5" r="2" strokeWidth={2} />
            <circle cx="19" cy="19" r="2" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12h5m2-5l-5 5m5 0l-5 5" />
          </svg>
        ),
      },
      {
        href: '/knowledge-preview',
        label: 'KB Preview',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ),
      },
      {
        href: '/ingest-preview',
        label: 'Ingest Preview',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v16H4z" />
          </svg>
        ),
      },
    ],
  },
  {
    // คุณภาพ + self-learning loop — evaluation, gaps, approvals
    label: 'Quality',
    minRole: 'viewer',
    items: [
      {
        href: '/evaluation',
        label: 'Evaluation',
        minRole: 'viewer',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        href: '/knowledge-gaps',
        label: 'Knowledge Gaps',
        minRole: 'admin',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        href: '/approvals',
        label: 'Approvals',
        minRole: 'admin',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      },
      {
        href: '/report',
        label: 'Report',
        minRole: 'viewer',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    // ระบบ infra — cache, memory, quota
    label: 'System',
    minRole: 'operator',
    items: [
      {
        href: '/cache',
        label: 'Semantic Cache',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        ),
      },
      {
        href: '/memory',
        label: 'Memory',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
          </svg>
        ),
      },
      {
        href: '/quota',
        label: 'Quota & Limits',
        minRole: 'operator',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.567-3 3.5S10.343 15 12 15s3-1.567 3-3.5S13.657 8 12 8zm0 0V4m0 11v5m8-8h-4M8 12H4m13.657 5.657l-2.828-2.828M9.172 9.172 6.343 6.343m11.314 0-2.828 2.829M9.172 14.828l-2.829 2.829" />
          </svg>
        ),
      },
    ],
  },
  {
    // admin-only — users, keys, audit, settings
    label: 'Admin',
    minRole: 'admin',
    items: [
      {
        href: '/settings',
        label: 'Settings',
        minRole: 'admin',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        href: '/admin-users',
        label: 'Users',
        minRole: 'admin',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V18a4 4 0 00-5-3.874M17 20H7m10 0v-2c0-.653-.126-1.277-.357-1.848M7 20H2V18a4 4 0 015-3.874M7 20v-2c0-.653.126-1.277.357-1.848m0 0a5.002 5.002 0 019.286 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
      {
        href: '/api-keys',
        label: 'API Keys',
        minRole: 'admin',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 114 0v2a2 2 0 01-2 2h-1m-4 0h4m-4 0a2 2 0 100 4h1m-1-4V9a2 2 0 10-4 0v6a2 2 0 104 0v-2m-6 4H5a2 2 0 01-2-2v-2a2 2 0 012-2h1m0 0a2 2 0 100-4H5" />
          </svg>
        ),
      },
      {
        href: '/audit-log',
        label: 'Audit Log',
        minRole: 'admin',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        ),
      },
    ],
  },
]

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()
  const activeRole: DashboardRole = user?.role ?? 'viewer'
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const visibleGroups = NAV_GROUPS
    .filter((group) => !group.minRole || ROLE_RANK[activeRole] >= ROLE_RANK[group.minRole])
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.minRole || ROLE_RANK[activeRole] >= ROLE_RANK[item.minRole]),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col min-h-screen fixed left-0 top-0">
      {/* Logo */}
      <div className="p-5 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white tracking-tight">RAG System</h1>
        <p className="text-xs text-gray-500 mt-0.5">Admin Dashboard</p>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {visibleGroups.map((group, index) => {
          const groupHasActiveItem = group.items.some(
            (item) => pathname === item.href || pathname.startsWith(item.href + '/')
          )
          const isCollapsed =
            collapsedGroups[group.label] ??
            !(groupHasActiveItem || index < 2)

          return (
          <div key={group.label} className="px-3 mb-3">
            <button
              type="button"
              onClick={() =>
                setCollapsedGroups((current) => ({
                  ...current,
                  [group.label]: !isCollapsed,
                }))
              }
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:bg-gray-800/60 hover:text-gray-300"
            >
              <span>{group.label}</span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {!isCollapsed ? (
            <div className="mt-1 space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      active
                        ? 'bg-purple-600/20 text-white border border-purple-700/40'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <span className={active ? 'text-purple-400' : ''}>{item.icon}</span>
                    {item.label}
                  </Link>
                )
              })}
            </div>
            ) : null}
          </div>
        )})}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-800">
        {user ? (
          <div className="flex items-center gap-3 group">
            {/* Avatar */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-600/20 ring-1 ring-purple-500/30 text-xs font-semibold text-purple-300 uppercase">
              {user.name?.charAt(0) ?? '?'}
            </div>
            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-200 leading-tight">{user.name}</p>
              <p className="text-[11px] text-gray-500 capitalize leading-tight">{user.role}</p>
            </div>
            {/* Logout icon */}
            <LogoutButton />
          </div>
        ) : (
          <p className="text-xs text-gray-600">RAG System v1.0</p>
        )}
      </div>
    </aside>
  )
}
