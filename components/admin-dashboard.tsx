"use client"

import { useState, useEffect, useCallback } from "react"
import JSZip from "jszip"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Download, CheckCircle, CheckCheck, LogOut, Loader2, RefreshCw, ImageDown } from "lucide-react"

interface Entry {
  id: string
  handle: string
  contact?: string
  imageUrl: string
  status: "pending" | "ready"
  createdAt: string
}

type Filter = "all" | "pending" | "ready"

interface AdminDashboardProps {
  password: string
  onLogout: () => void
}

export function AdminDashboard({ password, onLogout }: AdminDashboardProps) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [filter, setFilter] = useState<Filter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/entries", {
        headers: { Authorization: `Bearer ${password}` },
      })
      if (!res.ok) {
        if (res.status === 401) {
          onLogout()
          return
        }
        throw new Error("Failed to fetch entries")
      }
      const data = await res.json()
      setEntries(data)
    } catch {
      setError("Failed to load entries")
    } finally {
      setLoading(false)
    }
  }, [password, onLogout])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const filteredEntries =
    filter === "all" ? entries : entries.filter((e) => e.status === filter)

  const totalCount = entries.length
  const pendingCount = entries.filter((e) => e.status === "pending").length
  const readyCount = entries.filter((e) => e.status === "ready").length

  async function markAsReady(id: string) {
    try {
      const res = await fetch(`/api/entries/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${password}`,
        },
        body: JSON.stringify({ status: "ready" }),
      })
      if (res.ok) {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === id ? { ...entry, status: "ready" as const } : entry
          )
        )
      }
    } catch {
      // silently fail
    }
  }

  // ─── Mark all pending entries as ready ──────────────────────────────
  const [markingAll, setMarkingAll] = useState(false)

  async function markAllReady() {
    if (pendingCount === 0) return
    setMarkingAll(true)
    try {
      const res = await fetch("/api/entries/mark-all-ready", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${password}` },
      })
      if (res.ok) {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.status === "pending" ? { ...entry, status: "ready" as const } : entry
          )
        )
      }
    } catch {
      // silently fail
    } finally {
      setMarkingAll(false)
    }
  }

  // ─── Download all profile images bundled into a single ZIP ───────────
  const [downloadingAll, setDownloadingAll] = useState(false)

  async function downloadAllImages() {
    const list = filteredEntries.filter((e) => e.imageUrl)
    if (list.length === 0) return
    setDownloadingAll(true)
    try {
      const zip = new JSZip()
      await Promise.all(
        list.map(async (entry) => {
          try {
            const res = await fetch(entry.imageUrl)
            const blob = await res.blob()
            const ext = blob.type.split("/")[1]?.split("+")[0] || "jpg"
            const arrayBuffer = await blob.arrayBuffer()
            zip.file(`${entry.handle}.${ext}`, arrayBuffer)
          } catch {
            // skip failed image
          }
        })
      )
      const content = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(content)
      const link = document.createElement("a")
      link.href = url
      link.download = "contest-images.zip"
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingAll(false)
    }
  }

  // CSV-escape: wrap in quotes if the value contains commas, quotes, or newlines
  function csvEscape(value: string): string {
    if (/[,"\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  function exportCSV() {
    const headers = ["Handle", "Image URL", "Contact", "Status", "Created At"]
    const rows = entries.map((e) => [
      csvEscape(e.handle),
      csvEscape(e.imageUrl),
      csvEscape(e.contact || ""),
      csvEscape(e.status),
      csvEscape(e.createdAt),
    ])
    const csvContent = [headers.map(csvEscape), ...rows].map((r) => r.join(",")).join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "contest-entries.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  // Download a single profile image
  async function downloadImage(entry: Entry) {
    try {
      const res = await fetch(entry.imageUrl)
      const blob = await res.blob()
      const ext = blob.type.split("/")[1]?.split("+")[0] || "jpg"
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${entry.handle}.${ext}`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // Fallback: open in new tab
      window.open(entry.imageUrl, "_blank")
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-secondary/50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-secondary/50 px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchEntries}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-svh bg-secondary/50">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Admin Panel
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage contest entries
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={fetchEntries}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={markAllReady}
              disabled={markingAll || pendingCount === 0}
            >
              {markingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              Mark All Ready
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadAllImages}
              disabled={downloadingAll || filteredEntries.length === 0}
            >
              {downloadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
              Download All
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total</p>
            <p className="mt-1 text-2xl font-semibold text-card-foreground">{totalCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending</p>
            <p className="mt-1 text-2xl font-semibold text-card-foreground">{pendingCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ready</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-600">{readyCount}</p>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="mb-4 flex items-center gap-2">
          {(["all", "pending", "ready"] as Filter[]).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
              className="capitalize"
            >
              {f}
            </Button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Image</TableHead>
                <TableHead>Handle</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead>Image</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No entries found
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <a href={entry.imageUrl} target="_blank" rel="noopener noreferrer" title="View full image">
                        <img
                          src={entry.imageUrl}
                          alt={`Avatar for ${entry.handle}`}
                          className="h-9 w-9 rounded-full bg-muted object-cover ring-offset-background transition-all hover:ring-2 hover:ring-ring hover:ring-offset-2"
                        />
                      </a>
                    </TableCell>
                    <TableCell className="font-medium text-card-foreground">
                      {entry.handle}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {entry.contact || "—"}
                    </TableCell>
                    <TableCell>
                      {entry.status === "ready" ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                          Ready
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadImage(entry)}
                        title="Download image"
                      >
                        <ImageDown className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.status === "pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markAsReady(entry.id)}
                        >
                          <CheckCircle className="h-4 w-4" />
                          <span className="hidden sm:inline">Mark Ready</span>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Done</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  )
}
