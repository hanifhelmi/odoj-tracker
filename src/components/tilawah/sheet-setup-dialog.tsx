'use client'

import { useState } from 'react'
import { create } from 'zustand'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpenText,
  Check,
  CircleCheckBig,
  Copy,
  Link2,
  LoaderCircle,
  TriangleAlert,
  Unplug,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { APPS_SCRIPT_CODE, SHEET_WEB_URL, type SheetSettings } from '@/lib/tilawah'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------
// Store kecil untuk membuka dialog dari mana saja
// ------------------------------------------------------------

interface SheetSetupState {
  open: boolean
  setOpen: (v: boolean) => void
}

export const useSheetSetupStore = create<SheetSetupState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}))

export function openSheetSetup() {
  useSheetSetupStore.setState({ open: true })
}

export function useSheetSettings() {
  return useQuery<SheetSettings>({
    queryKey: ['sheet-settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error('Gagal memuat pengaturan Google Sheet')
      return res.json()
    },
  })
}

// ------------------------------------------------------------
// Dialog setup: langkah deploy Apps Script + input Web App URL
// ------------------------------------------------------------

const LANGKAH: { judul: string; isi: string }[] = [
  {
    judul: 'Buka editor Apps Script',
    isi: 'Di Google Sheet, klik menu Ekstensi (Extensions) → Apps Script.',
  },
  {
    judul: 'Tempel kode jembatan',
    isi: 'Hapus isi editor, tempel seluruh kode di bawah, lalu simpan (Ctrl+S).',
  },
  {
    judul: 'Deploy sebagai Web App',
    isi: 'Klik Deploy → Deployment baru → tipe "Aplikasi web". Isi: Execute as = Me, Who has access = Anyone.',
  },
  {
    judul: 'Salin Web app URL',
    isi: 'Setelah deploy (dan mengizinkan akses), salin URL yang berakhiran /exec, lalu tempel di kolom bawah.',
  },
]

export function SheetSetupDialog() {
  const { open, setOpen } = useSheetSetupStore()
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const settings = useSheetSettings()

  const connectMutation = useMutation({
    mutationFn: async (u: string) => {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string; push?: { ok: boolean; pushed?: number } }
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Gagal menghubungkan')
      return body
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: ['sheet-settings'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['day'] })
      toast({
        title: 'Google Sheet terhubung ✓',
        description: body.push?.ok
          ? `${body.push.pushed ?? 0} perubahan tertunda berhasil ditulis ke Sheet.`
          : 'Update status kini ikut menulis langsung ke Google Sheet.',
      })
      setOpen(false)
    },
    onError: (err) => {
      toast({
        title: 'Gagal menghubungkan',
        description: err instanceof Error ? err.message : 'Coba periksa lagi',
        variant: 'destructive',
      })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings', { method: 'DELETE' })
      if (!res.ok) throw new Error('Gagal memutus koneksi')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sheet-settings'] })
      toast({ title: 'Koneksi diputus', description: 'Update kini hanya tersimpan di aplikasi.' })
    },
    onError: (err) => {
      toast({
        title: 'Gagal memutus koneksi',
        description: err instanceof Error ? err.message : 'Coba lagi',
        variant: 'destructive',
      })
    },
  })

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_CODE)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Gagal menyalin', description: 'Silakan salin manual dari kotak kode.', variant: 'destructive' })
    }
  }

  const urlValid = /^https:\/\/script\.google\.com\/.+\/exec/.test(url.trim())

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <Link2 className="size-5 text-emerald-600" aria-hidden />
            Hubungkan Aplikasi ke Google Sheet
          </DialogTitle>
          <DialogDescription className="text-left">
            Agar setiap update status <b>langsung menulis ke Google Sheet</b>, pasang jembatan Google Apps Script
            berikut. Cukup sekali setup (±2 menit), admin sheet yang melakukan.
          </DialogDescription>
        </DialogHeader>

        {/* Langkah-langkah */}
        <ol className="space-y-2.5">
          {LANGKAH.map((l, i) => (
            <li key={l.judul} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-stone-800">{l.judul}</p>
                <p className="text-xs leading-relaxed text-stone-500">{l.isi}</p>
              </div>
            </li>
          ))}
        </ol>

        <a
          href={SHEET_WEB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
        >
          <BookOpenText className="size-3.5" aria-hidden />
          Buka Google Sheet
        </a>

        {/* Kode Apps Script */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-stone-700">Kode Code.gs</p>
            <Button
              variant="outline"
              size="sm"
              onClick={copyCode}
              className={cn(
                'h-8 gap-1.5 px-2.5 text-xs',
                copied && 'border-emerald-300 text-emerald-700',
              )}
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copied ? 'Tersalin!' : 'Salin Kode'}
            </Button>
          </div>
          <pre className="max-h-56 overflow-auto rounded-lg bg-stone-950 p-3 text-[11px] leading-relaxed text-emerald-100">
            <code>{APPS_SCRIPT_CODE}</code>
          </pre>
          <p className="mt-1.5 text-[11px] text-stone-400">
            Catatan: bila nanti kode diubah, lakukan Deploy → Manage deployments → Edit → New version.
          </p>
        </div>

        {/* Input URL */}
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5">
          <label htmlFor="webapp-url" className="text-xs font-semibold text-stone-700">
            Web App URL (akhiran /exec)
          </label>
          <Input
            id="webapp-url"
            key={settings.data?.url ?? 'empty'}
            defaultValue={settings.data?.url ?? ''}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/AKfycb.../exec"
            className="mt-1.5 min-h-[44px] border-stone-300 bg-white text-sm"
            autoComplete="url"
          />
          {settings.data?.connected && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
              <CircleCheckBig className="size-3.5" aria-hidden />
              Saat ini terhubung: {settings.data.url}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {settings.data?.connected && (
            <Button
              variant="ghost"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="min-h-[44px] text-stone-500 hover:text-red-600"
            >
              <Unplug className="size-4" aria-hidden />
              Putuskan Koneksi
            </Button>
          )}
          <Button
            onClick={() => connectMutation.mutate(url.trim())}
            disabled={!urlValid || connectMutation.isPending}
            className="min-h-[44px] flex-1 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
          >
            {connectMutation.isPending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Menguji Koneksi…
              </>
            ) : (
              <>
                <CircleCheckBig className="size-4" aria-hidden />
                Uji Koneksi &amp; Simpan
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------
// Banner status koneksi (dipakai di halaman Update Progress)
// ------------------------------------------------------------

export function SheetConnectionBanner() {
  const settings = useSheetSettings()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const pushMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/push', { method: 'POST' })
      const body = (await res.json()) as { ok?: boolean; push?: { pushed?: number }; error?: string }
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Gagal mengirim')
      return body
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: ['sheet-settings'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({
        title: 'Terkirim ke Google Sheet ✓',
        description: `${body.push?.pushed ?? 0} baris berhasil diperbarui di Sheet.`,
      })
    },
    onError: (err) => {
      toast({
        title: 'Gagal mengirim ke Sheet',
        description: err instanceof Error ? err.message : 'Coba lagi',
        variant: 'destructive',
      })
    },
  })

  if (!settings.data) return null

  if (!settings.data.connected) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center">
        <TriangleAlert className="size-5 shrink-0 text-amber-600" aria-hidden />
        <p className="flex-1 text-sm leading-relaxed text-amber-900">
          <span className="font-semibold">Google Sheet belum terhubung.</span> Perubahan status hanya tersimpan di
          aplikasi ini. Hubungkan aplikasi ke Google Sheet agar setiap update langsung menulis ke Sheet.
        </p>
        <Button
          onClick={openSheetSetup}
          className="min-h-[44px] shrink-0 bg-amber-600 font-semibold text-white hover:bg-amber-700"
        >
          <Link2 className="size-4" aria-hidden />
          Hubungkan Sekarang
        </Button>
      </div>
    )
  }

  if (settings.data.pendingCount > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-teal-300 bg-teal-50 p-4 sm:flex-row sm:items-center">
        <LoaderCircle className="size-5 shrink-0 text-teal-600" aria-hidden />
        <p className="flex-1 text-sm text-teal-900">
          <span className="font-semibold">{settings.data.pendingCount} perubahan</span> belum terkirim ke Google
          Sheet.
        </p>
        <Button
          onClick={() => pushMutation.mutate()}
          disabled={pushMutation.isPending}
          className="min-h-[44px] shrink-0 bg-teal-600 font-semibold text-white hover:bg-teal-700"
        >
          {pushMutation.isPending ? 'Mengirim…' : 'Kirim Ulang'}
        </Button>
      </div>
    )
  }

  return null
}
