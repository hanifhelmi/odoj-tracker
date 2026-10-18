'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpenText,
  LayoutDashboard,
  RefreshCw,
  SquarePen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { SHEET_WEB_URL } from '@/lib/tilawah'
import { DashboardView } from '@/components/tilawah/dashboard-view'
import { UpdateView } from '@/components/tilawah/update-view'

type View = 'dashboard' | 'update'

export default function Home() {
  const [view, setView] = useState<View>('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/sync?force=1', { method: 'POST' })
      const body = (await res.json()) as { ok?: boolean; rows?: number; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Sinkronisasi gagal')
      return body
    },
    onSuccess: (body) => {
      setRefreshKey((k) => k + 1)
      queryClient.invalidateQueries()
      toast({
        title: 'Sinkronisasi berhasil',
        description: `${body.rows ?? 0} baris data diperbarui dari Google Sheets.`,
      })
    },
    onError: (err) => {
      toast({
        title: 'Sinkronisasi gagal',
        description: err instanceof Error ? err.message : 'Coba lagi nanti',
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/80 via-white to-white">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <BookOpenText className="size-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight tracking-tight text-stone-900 sm:text-lg">
                Tilawah Tracker
              </h1>
              <p className="text-xs text-stone-500">One Day One Juz</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Navigasi menu */}
            <nav
              aria-label="Menu utama"
              className="flex flex-1 items-center gap-1 rounded-xl border border-stone-200 bg-stone-50 p-1 sm:flex-none"
            >
              <button
                onClick={() => setView('dashboard')}
                aria-current={view === 'dashboard' ? 'page' : undefined}
                className={cn(
                  'flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all sm:flex-none',
                  view === 'dashboard'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-white hover:text-stone-900',
                )}
              >
                <LayoutDashboard className="size-4" aria-hidden />
                Dashboard
              </button>
              <button
                onClick={() => setView('update')}
                aria-current={view === 'update' ? 'page' : undefined}
                className={cn(
                  'flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all sm:flex-none',
                  view === 'update'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-white hover:text-stone-900',
                )}
              >
                <SquarePen className="size-4" aria-hidden />
                Update Progress
              </button>
            </nav>

            {/* Sinkron manual */}
            <Button
              variant="outline"
              size="icon"
              aria-label="Sinkronkan data dari Google Sheets"
              title="Sinkronkan data dari Google Sheets"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
              className="min-h-[44px] min-w-[44px] shrink-0 border-stone-200 text-stone-600 hover:text-emerald-700"
            >
              <RefreshCw className={cn('size-4', syncMutation.isPending && 'animate-spin')} aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- Konten ---------- */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
          >
            {view === 'dashboard' ? (
              <DashboardView refreshKey={refreshKey} />
            ) : (
              <UpdateView refreshKey={refreshKey} onGoDashboard={() => setView('dashboard')} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ---------- Footer (sticky di bawah viewport) ---------- */}
      <footer className="mt-auto border-t border-stone-200/80 bg-white/70">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-1.5 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-xs text-stone-500 sm:flex-row">
          <p>
            Data disinkronkan otomatis dari{' '}
            <a
              href={SHEET_WEB_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
            >
              Google Sheets
            </a>
          </p>
          <p>Tilawah Tracker • One Day One Juz • Barokallahu fiikum</p>
        </div>
      </footer>
    </div>
  )
}
