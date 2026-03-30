import Link from 'next/link'
import { requireAdminPageSession } from '@/lib/authz'

const adminCards = [
  {
    href: '/admin-users',
    title: 'Dashboard Users',
    description: 'Manage login accounts for the dashboard. This is where user ID, role, and password live.',
    accent: 'from-purple-600/20 to-purple-900/20 border-purple-500/30',
    bullet: 'Use this when you need to create, revoke, or reassign a dashboard user.',
  },
  {
    href: '/api-keys',
    title: 'Service API Keys',
    description: 'Manage client IDs and their DB-backed API keys for service-to-service access.',
    accent: 'from-cyan-600/20 to-cyan-900/20 border-cyan-500/30',
    bullet: 'Use this when a service caller needs a new client ID or a revoked key.',
  },
  {
    href: '/audit-log',
    title: 'Audit Log',
    description: 'Review who changed admin users, API keys, and other control-plane actions.',
    accent: 'from-amber-600/20 to-amber-900/20 border-amber-500/30',
    bullet: 'Use this to trace who created or changed access records.',
  },
  {
    href: '/settings',
    title: 'Settings',
    description: 'Check dashboard configuration, service health, and active environment values.',
    accent: 'from-emerald-600/20 to-emerald-900/20 border-emerald-500/30',
    bullet: 'Use this to confirm POSTGRES_URL, secrets, and service wiring.',
  },
]

export default async function AdminPage() {
  await requireAdminPageSession()

  return (
    <div className="min-h-screen bg-gray-950 p-8 text-white">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="rounded-3xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-950 to-gray-900 p-8 shadow-2xl shadow-black/20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Admin Control Plane</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight">Manage users, client IDs, and system access from one place.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-gray-300">
              This hub is the entry point for dashboard accounts and service keys. If you want to see where
              a user ID or client ID is managed, start here and jump into the dedicated page.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
              <p className="text-xs uppercase tracking-wider text-gray-500">What this page is for</p>
              <p className="mt-2 text-sm text-gray-200">A single starting point for admin tasks.</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
              <p className="text-xs uppercase tracking-wider text-gray-500">User ID</p>
              <p className="mt-2 text-sm text-gray-200">Managed under Dashboard Users.</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
              <p className="text-xs uppercase tracking-wider text-gray-500">Client ID</p>
              <p className="mt-2 text-sm text-gray-200">Managed under Service API Keys.</p>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {adminCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`group rounded-3xl border bg-gradient-to-br p-6 transition-transform duration-200 hover:-translate-y-1 hover:shadow-2xl ${card.accent}`}
            >
              <div className="flex h-full flex-col justify-between gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gray-300">Admin section</p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">{card.title}</h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-gray-300">{card.description}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-gray-200">
                  {card.bullet}
                </div>
              </div>
            </Link>
          ))}
        </section>

        <section className="grid gap-4 rounded-3xl border border-gray-800 bg-gray-900/80 p-6 lg:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Suggested flow</p>
            <p className="mt-2 text-sm text-gray-200">1. Open Dashboard Users or Service API Keys.</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">If the page fails</p>
            <p className="mt-2 text-sm text-gray-200">Check admin session, POSTGRES_URL, and dashboard env values.</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">If a service call fails</p>
            <p className="mt-2 text-sm text-gray-200">Check service API keys, DB schema, and the service logs.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
