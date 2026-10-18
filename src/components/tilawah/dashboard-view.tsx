'use client'

import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  BookOpenCheck,
  CalendarDays,
  CircleCheckBig,
  Clock3,
  Flame,
  Medal,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { DashboardData, ParticipantStats } from '@/lib/tilawah'
import { formatTanggal, formatWaktu, todayJakarta } from '@/lib/tilawah'
import { STATUS_META, StatusBadge } from '@/components/tilawah/status-controls'

async function fetchDashboard(hariIni: string): Promise<DashboardData> {
  const res = await fetch(`/api/dashboard?date=${hariIni}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Gagal memuat dashboard')
  }
  return res.json()
}

export function DashboardView({ refreshKey }: { refreshKey: number }) {
  const hariIni = todayJakarta()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', hariIni, refreshKey],
    queryFn: () => fetchDashboard(hariIni),
  })

  if (isError) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="font-medium text-red-800">Gagal memuat data dashboard</p>
          <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Coba lagi'}</p>
          <button
            onClick={() => refetch()}
            className="mt-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Coba Lagi
          </button>
        </CardContent>
      </Card>
    )
  }

  if (isLoading || !data) return <DashboardSkeleton />

  return (
    <div className="space-y-6">
      <HeroBanner data={data} />
      <StatCards data={data} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PesertaRanking peserta={data.peserta} />
        </div>
        <AktivitasTerakhir items={data.aktivitasTerakhir} />
      </div>
      <MatriksCapaian data={data} />
    </div>
  )
}

// ------------------------------------------------------------
// Hero
// ------------------------------------------------------------

function HeroBanner({ data }: { data: DashboardData }) {
  const posisi = data.posisiProgram
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 p-6 text-white shadow-lg sm:p-8"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-14 select-none text-[10rem] leading-none opacity-10"
        aria-hidden
      >
        ☪
      </div>
      <p className="text-sm font-medium text-emerald-100">Assalamu&apos;alaikum warahmatullah</p>
      <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
        Program Tilawah One Day One Juz
      </h2>
      <p className="mt-2 max-w-xl text-sm text-emerald-50/90">
        {posisi ? (
          <>
            Saat ini program berada pada <span className="font-semibold text-white">hari ke-{posisi.harike}</span>{' '}
            dengan target <span className="font-semibold text-white">Juz {posisi.juz} Bagian {posisi.bagian}</span>.
            Masih ada <span className="font-semibold text-white">{data.sisaDiPosisi} peserta</span> yang belum
            menyelesaikan target ini.
          </>
        ) : (
          <>Masya Allah, seluruh jadwal yang tercatat sudah diselesaikan semua peserta. Barokallahu fiikum!</>
        )}
      </p>

      <div className="mt-5 max-w-md">
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-emerald-100">
          <span>Progres keseluruhan tim</span>
          <span className="tabular-nums">
            {data.totalSelesai}/{data.totalTarget} bagian ({data.progressKeseluruhan}%)
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-emerald-900/40">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${data.progressKeseluruhan}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-200"
          />
        </div>
        {data.lastSync && (
          <p className="mt-2.5 text-[11px] text-emerald-100/70">
            Terakhir disinkronkan: {formatWaktu(data.lastSync)} (waktu server)
          </p>
        )}
      </div>
    </motion.section>
  )
}

// ------------------------------------------------------------
// Stat cards
// ------------------------------------------------------------

function StatCards({ data }: { data: DashboardData }) {
  const juzTerkumpul = data.totalSelesai / 2
  const juzLabel = Number.isInteger(juzTerkumpul)
    ? String(juzTerkumpul)
    : juzTerkumpul.toFixed(1).replace('.', ',')

  const stats = [
    {
      icon: CalendarDays,
      label: 'Posisi Program',
      value: data.posisiProgram ? `Hari ke-${data.posisiProgram.harike}` : 'Selesai',
      sub: data.posisiProgram
        ? `Target ${data.posisiProgram.target} • Juz ${data.posisiProgram.juz} ${data.posisiProgram.bagian === 'A' ? 'awal' : 'akhir'}`
        : 'Semua jadwal tuntas',
      tone: 'text-emerald-600 bg-emerald-50',
    },
    {
      icon: CircleCheckBig,
      label: 'Capaian Hari Ini',
      value: data.hariIni ? `${data.selesaiHariIni}/${data.totalPeserta}` : '—',
      sub: data.hariIni
        ? `${formatTanggal(data.hariIni.tanggal)} • hari ke-${data.hariIni.harike}`
        : 'Tidak ada jadwal bertanggal hari ini',
      tone: 'text-teal-600 bg-teal-50',
    },
    {
      icon: BookOpenCheck,
      label: 'Juz Terkumpul Tim',
      value: `${juzLabel} juz`,
      sub: `${data.totalSelesai} bagian selesai dari ${data.totalTarget}`,
      tone: 'text-amber-600 bg-amber-50',
    },
    {
      icon: Users,
      label: 'Peserta Aktif',
      value: `${data.totalPeserta} orang`,
      sub: `${data.totalHari} hari jadwal tercatat`,
      tone: 'text-stone-600 bg-stone-100',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.06 }}
        >
          <Card className="h-full border-stone-200/80 shadow-sm">
            <CardContent className="flex items-start gap-3 p-4">
              <div className={cn('rounded-lg p-2', s.tone)}>
                <s.icon className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-stone-500">{s.label}</p>
                <p className="mt-0.5 text-lg font-bold tracking-tight text-stone-900 tabular-nums sm:text-xl">
                  {s.value}
                </p>
                <p className="mt-0.5 truncate text-xs text-stone-500">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------
// Ranking peserta
// ------------------------------------------------------------

function PesertaRanking({ peserta }: { peserta: ParticipantStats[] }) {
  return (
    <Card className="border-stone-200/80 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Medal className="size-4 text-amber-500" aria-hidden />
          Pencapaian per Peserta
        </CardTitle>
        <CardDescription>Peringkat berdasarkan jumlah bagian juz yang selesai ditilawah</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {peserta.map((p, i) => {
          const meta = p.statusHariIni ? STATUS_META[p.statusHariIni] : null
          return (
            <motion.div
              key={p.nama}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className={cn(
                'rounded-xl border p-3.5 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40',
                i === 0 && p.selesai > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-stone-200 bg-white',
              )}
            >
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div
                    className={cn(
                      'flex size-10 items-center justify-center rounded-full text-sm font-bold text-white',
                      i === 0 && p.selesai > 0 ? 'bg-amber-500' : 'bg-emerald-600',
                    )}
                    aria-hidden
                  >
                    {p.nama
                      .split(' ')
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </div>
                  <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border bg-white text-[10px] font-bold text-stone-600 shadow-sm">
                    {i + 1}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate font-semibold text-stone-900">{p.nama}</p>
                    {p.selesai > 0 && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        <Flame className="size-3" aria-hidden />
                        {p.juzSelesai} juz
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-stone-500">
                    <Clock3 className="size-3" aria-hidden />
                    Update terakhir: {formatWaktu(p.lastUpdate)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <StatusBadge status={p.statusHariIni} />
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs text-stone-500">
                  <span className="tabular-nums">
                    {p.selesai} selesai • {p.onProgress} on progress • {p.belum} belum
                  </span>
                  <span className="font-semibold text-stone-700 tabular-nums">{p.progressPct}%</span>
                </div>
                <Progress value={p.progressPct} className="h-2 bg-stone-100 [&>div]:bg-emerald-500" />
              </div>
            </motion.div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------
// Aktivitas terakhir
// ------------------------------------------------------------

function AktivitasTerakhir({ items }: { items: DashboardData['aktivitasTerakhir'] }) {
  return (
    <Card className="h-fit border-stone-200/80 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4 text-emerald-600" aria-hidden />
          Aktivitas Terakhir
        </CardTitle>
        <CardDescription>Update status terbaru dari semua peserta</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-400">Belum ada aktivitas tercatat</p>
        ) : (
          <ol className="relative space-y-4 border-l border-stone-200 pl-5">
            {items.map((a, i) => {
              const meta = STATUS_META[a.status]
              return (
                <li key={`${a.nama}-${a.harike}-${i}`} className="relative">
                  <span
                    className={cn(
                      'absolute -left-[26px] top-0.5 flex size-4 items-center justify-center rounded-full ring-4 ring-white',
                      meta.dot,
                    )}
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-stone-800">
                    {a.nama} <span className="font-normal text-stone-500">→ {a.status}</span>
                  </p>
                  <p className="text-xs text-stone-500">
                    Hari ke-{a.harike} • target {a.target} • {formatWaktu(a.waktu)}
                    {a.source === 'app' && (
                      <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700">
                        via app
                      </span>
                    )}
                  </p>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------
// Matriks capaian
// ------------------------------------------------------------

function MatriksCapaian({ data }: { data: DashboardData }) {
  return (
    <Card className="border-stone-200/80 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Matriks Capaian Harian</CardTitle>
        <CardDescription>
          Ringkasan status tiap peserta untuk setiap hari program (hari ke-{data.matriks[0]?.harike ?? 1} s.d. hari
          ke-{data.matriks[data.matriks.length - 1]?.harike ?? 1})
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-auto rounded-lg border border-stone-100">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-stone-50">
              <tr>
                <th className="sticky left-0 z-20 bg-stone-50 px-3 py-2.5 text-left font-semibold text-stone-700">
                  Peserta
                </th>
                {data.matriks.map((m) => (
                  <th
                    key={m.harike}
                    className="px-2 py-2.5 text-center text-xs font-semibold text-stone-600"
                    title={`Hari ke-${m.harike} • ${m.target} • ${formatTanggal(m.tanggal)}`}
                  >
                    <div>ke-{m.harike}</div>
                    <div className="text-[10px] font-normal text-stone-400">{m.target}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.peserta.map((p) => (
                <tr key={p.nama} className="border-t border-stone-100 hover:bg-stone-50/60">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-stone-700 group-hover:bg-stone-50">
                    {p.nama}
                  </td>
                  {data.matriks.map((m) => {
                    const st = m.statuses[p.nama]
                    const meta = st ? STATUS_META[st] : null
                    return (
                      <td key={m.harike} className="px-2 py-2 text-center">
                        <span
                          className={cn(
                            'mx-auto flex size-6 items-center justify-center rounded-md',
                            meta?.dot ?? 'bg-stone-100',
                            st && 'ring-2 ring-inset ring-white/30',
                          )}
                          title={`${p.nama} • hari ke-${m.harike} (${m.target}): ${st ?? '—'}`}
                          aria-label={`${p.nama} hari ke-${m.harike}: ${st ?? 'tidak ada data'}`}
                          role="img"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-stone-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded bg-emerald-500" aria-hidden /> Selesai
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded bg-amber-400" aria-hidden /> On Progress
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded bg-stone-300" aria-hidden /> Belum
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------
// Skeleton
// ------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-48 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
