'use client'

import { CheckCircle2, CircleDashed, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StatusTilawah } from '@/lib/tilawah'
import { STATUS_LIST } from '@/lib/tilawah'

export const STATUS_META: Record<
  StatusTilawah,
  { label: string; icon: typeof CheckCircle2; badge: string; dot: string; solid: string }
> = {
  Belum: {
    label: 'Belum',
    icon: CircleDashed,
    badge: 'bg-stone-100 text-stone-600 border-stone-200',
    dot: 'bg-stone-300',
    solid: 'bg-stone-400 text-white border-stone-400',
  },
  'On Progress': {
    label: 'On Progress',
    icon: LoaderCircle,
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-400',
    solid: 'bg-amber-400 text-amber-950 border-amber-400',
  },
  Selesai: {
    label: 'Selesai',
    icon: CheckCircle2,
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
    solid: 'bg-emerald-600 text-white border-emerald-600',
  },
}

export function StatusBadge({
  status,
  className,
}: {
  status: StatusTilawah | null
  className?: string
}) {
  if (!status) {
    return (
      <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-stone-50 text-stone-400 border-stone-200', className)}>
        Tanpa jadwal
      </span>
    )
  }
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        meta.badge,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  )
}

interface StatusSegmentedProps {
  value: StatusTilawah
  onChange: (next: StatusTilawah) => void
  disabled?: boolean
}

/** Kontrol status 3 pilihan: Belum / On Progress / Selesai */
export function StatusSegmented({ value, onChange, disabled }: StatusSegmentedProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Status tilawah"
      className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 gap-0.5"
    >
      {STATUS_LIST.map((s) => {
        const meta = STATUS_META[s]
        const Icon = meta.icon
        const active = value === s
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(s)}
            className={cn(
              'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 text-xs sm:text-sm font-medium transition-all',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
              'disabled:cursor-not-allowed disabled:opacity-60',
              active
                ? cn('shadow-sm border', meta.solid)
                : 'text-stone-500 hover:text-stone-800 hover:bg-white border border-transparent',
            )}
          >
            <Icon className={cn('size-3.5 sm:size-4', active && s === 'On Progress' && 'animate-spin')} aria-hidden />
            <span className="hidden min-[380px]:inline">{meta.label}</span>
          </button>
        )
      })}
    </div>
  )
}
