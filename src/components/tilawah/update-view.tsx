'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Info,
  PartyPopper,
  Save,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  type DayEntry,
  type DayResponse,
  type PushResult,
  type StatusTilawah,
  formatTanggal,
  formatWaktu,
  todayJakarta,
} from '@/lib/tilawah'
import { StatusSegmented } from '@/components/tilawah/status-controls'
import { SheetConnectionBanner, openSheetSetup } from '@/components/tilawah/sheet-setup-dialog'

const pad = (n: number) => String(n).padStart(2, '0')
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function fetchDay(date: string, harike: number | null): Promise<DayResponse> {
  const qs = harike != null ? `harike=${harike}` : `date=${date}`
  const res = await fetch(`/api/day?${qs}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Gagal memuat jadwal')
  }
  return res.json()
}

interface UpdateViewProps {
  onGoDashboard: () => void
  refreshKey: number
}

export function UpdateView({ onGoDashboard, refreshKey }: UpdateViewProps) {
  const queryClient = useQueryClient()
  const [selectedDate, setSelectedDate] = useState<string>(() => todayJakarta())
  const [selectedHarike, setSelectedHarike] = useState<number | null>(null)
  const [edits, setEdits] = useState<Record<string, StatusTilawah>>({})
  const [calOpen, setCalOpen] = useState(false)
  const [congratsOpen, setCongratsOpen] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [pushResult, setPushResult] = useState<PushResult | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['day', selectedDate, selectedHarike, refreshKey],
    queryFn: () => fetchDay(selectedDate, selectedHarike),
  })

  // Reset editan lokal ketika pindah hari (penyesuaian state saat render,
  // pola resmi React untuk "reset state saat props berubah")
  const currentHarike = data?.day?.harike ?? null
  const [lastHarike, setLastHarike] = useState<number | null>(currentHarike)
  if (currentHarike !== lastHarike) {
    setLastHarike(currentHarike)
    setEdits({})
  }

  const day = data?.day ?? null
  const entries = data?.entries ?? []
  const semuaHari = data?.semuaHari ?? []

  const effective = useMemo(() => {
    const map = new Map<string, StatusTilawah>()
    for (const e of entries) map.set(e.nama, edits[e.nama] ?? e.status)
    return map
  }, [entries, edits])

  const changedRows = useMemo(
    () => entries.filter((e) => edits[e.nama] && edits[e.nama] !== e.status),
    [entries, edits],
  )

  const selesaiCount = [...effective.values()].filter((s) => s === 'Selesai').length
  const perluUpdate = effective.size - selesaiCount

  const saveMutation = useMutation({
    mutationFn: async (updates: { harike: number; nama: string; status: StatusTilawah }[]) => {
      const res = await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string; push?: PushResult }
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Gagal menyimpan')
      return body
    },
    onSuccess: (body, updates) => {
      setSavedCount(updates.length)
      setPushResult(body.push ?? null)
      setEdits({})
      queryClient.invalidateQueries({ queryKey: ['day'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['sheet-settings'] })
      setCongratsOpen(true)
    },
  })

  // Kirim ulang perubahan yang gagal terkirim ke Google Sheet
  const pushMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/push', { method: 'POST' })
      const body = (await res.json()) as { ok?: boolean; push?: PushResult; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Gagal mengirim')
      return body
    },
    onSuccess: (body) => {
      setPushResult(body.push ?? { ok: true, pushed: 0 })
      queryClient.invalidateQueries({ queryKey: ['sheet-settings'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['day'] })
    },
  })

  const pickDate = (iso: string) => {
    setSelectedDate(iso)
    setSelectedHarike(null)
    setCalOpen(false)
  }

  const pickHarike = (val: string) => {
    const h = parseInt(val, 10)
    const info = semuaHari.find((d) => d.harike === h)
    setSelectedHarike(h)
    setSelectedDate(info?.tanggal ?? '')
  }

  const handleSave = () => {
    if (changedRows.length === 0 || !day) return
    saveMutation.mutate(
      changedRows.map((e) => ({ harike: e.harike, nama: e.nama, status: edits[e.nama] })),
    )
  }

  return (
    <div className="space-y-6">
      {/* ---------- Status koneksi Google Sheet ---------- */}
      <SheetConnectionBanner />

      {/* ---------- Pilih jadwal ---------- */}
      <Card className="border-stone-200/80 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-emerald-600" aria-hidden />
            Pilih Tanggal Jadwal
          </CardTitle>
          <CardDescription>
            Secara bawaan menampilkan jadwal hari ini. Gunakan pilihan hari bila tanggal tidak memiliki jadwal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Date picker */}
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                aria-label="Pilih tanggal"
                className="min-h-[44px] w-full justify-start gap-2 border-stone-200 text-left font-normal sm:w-[260px]"
              >
                <CalendarDays className="size-4 text-emerald-600" aria-hidden />
                <span className={selectedDate ? 'text-stone-800' : 'text-stone-400'}>
                  {selectedDate ? formatTanggal(selectedDate) : 'Pilih tanggal'}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate ? new Date(`${selectedDate}T00:00:00`) : undefined}
                defaultMonth={selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date()}
                onSelect={(d) => d && pickDate(toISO(d))}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {/* Hari selector */}
          <Select value={selectedHarike != null ? String(selectedHarike) : ''} onValueChange={pickHarike}>
            <SelectTrigger
              aria-label="Pilih hari program"
              className="min-h-[44px] w-full border-stone-200 sm:w-[280px]"
            >
              <SelectValue placeholder="Pilih hari program" />
            </SelectTrigger>
            <SelectContent>
              {semuaHari.map((d) => (
                <SelectItem key={d.harike} value={String(d.harike)}>
                  Hari ke-{d.harike} • {d.target}
                  {d.tanggal ? ` • ${formatTanggal(d.tanggal)}` : ''}
                  {d.selesaiCount === d.totalPeserta ? ' ✓' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="flex items-center gap-1.5 text-xs text-stone-500 sm:ml-auto sm:max-w-[220px]">
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
            Kalendar hanya menampilkan tanggal yang memiliki jadwal di sheet.
          </p>
        </CardContent>
      </Card>

      {/* ---------- Banner saran bila tanggal tidak ada jadwal ---------- */}
      <AnimatePresence>
        {!isLoading && !day && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <Info className="size-5 shrink-0 text-amber-600" aria-hidden />
                <div className="flex-1">
                  <p className="font-medium text-amber-900">
                    Tidak ada jadwal tilawah pada tanggal {selectedDate ? formatTanggal(selectedDate) : 'ini'}.
                  </p>
                  {data?.suggestion && (
                    <p className="mt-0.5 text-sm text-amber-700">
                      Jadwal yang masih perlu diupdate:{' '}
                      <span className="font-semibold">
                        hari ke-{data.suggestion.harike} (target {data.suggestion.target}
                        {data.suggestion.tanggal ? `, ${formatTanggal(data.suggestion.tanggal)}` : ''})
                      </span>
                    </p>
                  )}
                </div>
                {data?.suggestion && (
                  <Button
                    onClick={() => pickHarike(String(data.suggestion!.harike))}
                    className="min-h-[44px] bg-amber-600 text-white hover:bg-amber-700"
                  >
                    Buka Hari ke-{data.suggestion.harike}
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Daftar peserta ---------- */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <TriangleAlert className="size-6 text-red-600" aria-hidden />
            <p className="font-medium text-red-800">Gagal memuat jadwal</p>
            <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Coba lagi'}</p>
          </CardContent>
        </Card>
      ) : day ? (
        <Card className="border-stone-200/80 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="size-4 text-emerald-600" aria-hidden />
                  Daftar Peserta — Hari ke-{day.harike}
                </CardTitle>
                <CardDescription className="mt-1">
                  Target <span className="font-semibold text-stone-700">{day.target}</span> • Juz {day.juz} Bagian{' '}
                  {day.bagian}
                  {day.tanggal ? ` • ${formatTanggal(day.tanggal)}` : ''}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 border border-emerald-200">
                  {selesaiCount} Selesai
                </span>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700 border border-amber-200">
                  {perluUpdate} perlu update
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {entries.map((e) => {
              const status = effective.get(e.nama) ?? e.status
              const isEdited = Boolean(edits[e.nama] && edits[e.nama] !== e.status)
              return (
                <div
                  key={e.nama}
                  className={cn(
                    'flex flex-col gap-3 rounded-xl border p-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between',
                    status === 'Selesai'
                      ? 'border-stone-200 bg-white'
                      : 'border-amber-200/70 bg-amber-50/40',
                    isEdited && 'border-emerald-300 bg-emerald-50/50',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white"
                      aria-hidden
                    >
                      {e.nama
                        .split(' ')
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-900">{e.nama}</p>
                      <p className="text-xs text-stone-500">
                        Update terakhir: {formatWaktu(e.updatedAt)}
                        {e.source === 'app' && (
                          <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700">
                            via app
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <StatusSegmented
                    value={status}
                    disabled={saveMutation.isPending}
                    onChange={(next) => setEdits((prev) => ({ ...prev, [e.nama]: next }))}
                  />
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- Bar simpan ---------- */}
      {day && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky bottom-4 z-20"
        >
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-2xl border border-stone-200 bg-white/95 p-3.5 shadow-lg backdrop-blur sm:flex-row sm:justify-between">
            <p className="text-sm text-stone-600">
              {changedRows.length > 0 ? (
                <>
                  <span className="font-semibold text-emerald-700">{changedRows.length} perubahan</span> belum
                  disimpan
                </>
              ) : (
                'Semua perubahan sudah tersimpan'
              )}
            </p>
            <Button
              onClick={handleSave}
              disabled={changedRows.length === 0 || saveMutation.isPending}
              className="min-h-[44px] w-full bg-emerald-600 px-6 font-semibold text-white hover:bg-emerald-700 sm:w-auto"
            >
              {saveMutation.isPending ? (
                <>
                  <Save className="size-4 animate-pulse" aria-hidden />
                  Menyimpan…
                </>
              ) : (
                <>
                  <Save className="size-4" aria-hidden />
                  Simpan Perubahan
                </>
              )}
            </Button>
          </div>
        </motion.div>
      )}

      {/* ---------- Popup ucapan selamat ---------- */}
      <Dialog open={congratsOpen} onOpenChange={setCongratsOpen}>
        <DialogContent className="max-w-sm rounded-2xl border-emerald-100 text-center sm:max-w-md">
          <DialogHeader className="items-center">
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16 }}
              className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-100"
            >
              <PartyPopper className="size-10 text-emerald-600" aria-hidden />
            </motion.div>
            <DialogTitle className="mt-3 text-2xl font-bold text-stone-900">
              Barokallahu fii kum! 🎉
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-relaxed text-stone-600">
              {savedCount > 0
                ? `${savedCount} status tilawah berhasil diperbarui`
                : 'Progress tilawah berhasil disimpan'}
              {day ? ` untuk hari ke-${day.harike} (target ${day.target}).` : '.'}
              <br />
              Semoga Allah memudahkan dan memberkahi khataman Al-Qur&apos;an kita semua.
            </DialogDescription>
          </DialogHeader>

          {/* ---------- Status penulisan ke Google Sheet ---------- */}
          {pushResult?.ok && (pushResult.pushed ?? 0) > 0 && (
            <p className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden />
              {pushResult.pushed} status berhasil ditulis ke Google Sheet
            </p>
          )}
          {pushResult && !pushResult.ok && (
            <div
              className={cn(
                'rounded-lg border p-3 text-xs leading-relaxed',
                pushResult.skipped
                  ? 'border-teal-200 bg-teal-50 text-teal-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900',
              )}
            >
              {pushResult.skipped ? (
                <>
                  <p>
                    Data tersimpan di aplikasi. Agar status <b>ikut ditulis ke Google Sheet</b>, hubungkan aplikasi
                    dengan jembatan Apps Script terlebih dulu.
                  </p>
                  <Button
                    onClick={() => {
                      setCongratsOpen(false)
                      openSheetSetup()
                    }}
                    className="mt-2 min-h-[40px] w-full bg-teal-600 font-semibold text-white hover:bg-teal-700"
                  >
                    Hubungkan Google Sheet
                  </Button>
                </>
              ) : (
                <>
                  <p>
                    Tersimpan di aplikasi, namun <b>gagal ditulis ke Google Sheet</b>: {pushResult.error}
                  </p>
                  <Button
                    onClick={() => pushMutation.mutate()}
                    disabled={pushMutation.isPending}
                    className="mt-2 min-h-[40px] w-full bg-amber-600 font-semibold text-white hover:bg-amber-700"
                  >
                    {pushMutation.isPending ? 'Mengirim ulang…' : 'Kirim Ulang ke Sheet'}
                  </Button>
                </>
              )}
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:justify-center">
            <Button
              onClick={() => {
                setCongratsOpen(false)
                onGoDashboard()
              }}
              className="min-h-[44px] w-full bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
            >
              Kembali ke Dashboard
            </Button>
            <Button
              variant="ghost"
              onClick={() => setCongratsOpen(false)}
              className="min-h-[44px] w-full text-stone-600"
            >
              Tetap di Halaman Ini
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
