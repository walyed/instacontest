"use client"

import { useState, useRef, useEffect, useCallback, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ImagePlus, Loader2, X } from "lucide-react"

export function ContestEntryForm() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [handle, setHandle] = useState("")
  const [contact, setContact] = useState("")
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Manual upload state
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // Auto-fetch state
  const [autoImageUrl, setAutoImageUrl] = useState<string | null>(null)
  const [fetchingImage, setFetchingImage] = useState(false)

  // ─── Auto-fetch Instagram profile image with debounce ──────────────
  const fetchImage = useCallback(async (username: string) => {
    const clean = username.replace(/^@/, "").trim()
    if (!clean || !/^[a-zA-Z0-9._]{1,30}$/.test(clean)) {
      setAutoImageUrl(null)
      return
    }
    setFetchingImage(true)
    try {
      const res = await fetch(`/api/instagram?username=${encodeURIComponent(clean)}`)
      const data = await res.json()
      if (data.image) {
        setAutoImageUrl(data.image)
        setErrors((prev) => { const next = { ...prev }; delete next.image; return next })
      } else {
        setAutoImageUrl(null)
      }
    } catch {
      setAutoImageUrl(null)
    } finally {
      setFetchingImage(false)
    }
  }, [])

  useEffect(() => {
    if (image) return
    const timer = setTimeout(() => { fetchImage(handle) }, 800)
    return () => clearTimeout(timer)
  }, [handle, fetchImage, image])

  // ─── Manual image upload handlers ──────────────────────────────────
  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setImage(file)
      setAutoImageUrl(null)
      const reader = new FileReader()
      reader.onloadend = () => setImagePreview(reader.result as string)
      reader.readAsDataURL(file)
      setErrors((prev) => { const next = { ...prev }; delete next.image; return next })
    }
  }

  function removeImage() {
    setImage(null)
    setImagePreview(null)
    setAutoImageUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const displayPreview = imagePreview ?? autoImageUrl

  // ─── Validation ────────────────────────────────────────────────────
  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!handle.trim()) errs.handle = "Instagram handle is required"
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))
      errs.contact = "Please enter a valid email"
    if (!image && !autoImageUrl) errs.image = "Profile image is required"
    if (!consent) errs.consent = "You must agree to the terms"
    return errs
  }

  // ─── Submit ────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append("handle", handle.trim())
      if (contact.trim()) formData.append("contact", contact.trim())

      if (image) {
        formData.append("image", image)
      } else if (autoImageUrl) {
        formData.append("autoImageUrl", autoImageUrl)
      }

      const res = await fetch("/api/entries", { method: "POST", body: formData })
      const data = await res.json()

      if (!data.success) {
        setErrors({ submit: data.message || "Failed to submit entry" })
        setLoading(false)
        return
      }
      router.push("/success")
    } catch {
      setErrors({ submit: "Something went wrong. Please try again." })
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* ── Handle ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="handle">Instagram Handle</Label>
        <Input
          id="handle"
          type="text"
          placeholder="@yourhandle"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value)
            if (errors.handle) {
              setErrors((prev) => { const next = { ...prev }; delete next.handle; return next })
            }
          }}
          aria-invalid={!!errors.handle}
        />
        {errors.handle && <p className="text-sm text-destructive">{errors.handle}</p>}
      </div>

      {/* ── Contact email ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="contact">
          Contact Email <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="contact"
          type="email"
          placeholder="you@example.com"
          value={contact}
          onChange={(e) => {
            setContact(e.target.value)
            if (errors.contact) {
              setErrors((prev) => { const next = { ...prev }; delete next.contact; return next })
            }
          }}
          aria-invalid={!!errors.contact}
        />
        {errors.contact && <p className="text-sm text-destructive">{errors.contact}</p>}
      </div>

      {/* ── Profile image (auto-fetch + manual upload) ────────────── */}
      <div className="flex flex-col gap-2">
        <Label>Profile Image</Label>

        {/* Loading spinner while auto-fetching */}
        {fetchingImage && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-6 justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Fetching profile image…</span>
          </div>
        )}

        {/* Preview (manual upload or auto-fetched) */}
        {!fetchingImage && displayPreview && (
          <div className="relative w-full">
            <div className="relative overflow-hidden rounded-xl border border-border bg-muted aspect-square max-w-[200px]">
              <img src={displayPreview} alt="Preview" className="h-full w-full object-cover" />
            </div>
            <button
              type="button"
              onClick={removeImage}
              className="absolute top-2 left-[172px] flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
              aria-label="Remove image"
            >
              <X className="h-4 w-4" />
            </button>
            {autoImageUrl && !image && (
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-fetched from Instagram — or upload your own below.
              </p>
            )}
          </div>
        )}

        {/* Upload zone */}
        {!fetchingImage && !displayPreview && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="sr-only"
              id="image-upload"
              aria-label="Upload profile image"
            />
            <label
              htmlFor="image-upload"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/50 py-8 transition-colors hover:border-foreground/30 hover:bg-muted"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/10">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Click to upload your image</p>
            </label>
          </>
        )}

        {/* Swap image link when preview is showing */}
        {!fetchingImage && displayPreview && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="sr-only"
              id="image-upload"
              aria-label="Upload profile image"
            />
            <label
              htmlFor="image-upload"
              className="mt-1 inline-flex cursor-pointer text-xs text-primary underline-offset-2 hover:underline"
            >
              Upload a different image
            </label>
          </>
        )}

        {errors.image && <p className="text-sm text-destructive">{errors.image}</p>}
      </div>

      {/* ── Consent ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <Checkbox
            id="consent"
            checked={consent}
            onCheckedChange={(checked) => {
              setConsent(checked === true)
              if (errors.consent) {
                setErrors((prev) => { const next = { ...prev }; delete next.consent; return next })
              }
            }}
            aria-invalid={!!errors.consent}
            className="mt-0.5"
          />
          <Label htmlFor="consent" className="text-sm font-normal leading-relaxed text-muted-foreground cursor-pointer">
            I agree to allow my username and profile image to be used for contest promotion.
          </Label>
        </div>
        {errors.consent && <p className="text-sm text-destructive">{errors.consent}</p>}
      </div>

      {errors.submit && <p className="text-sm text-destructive text-center">{errors.submit}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          "Submit Entry"
        )}
      </Button>
    </form>
  )
}
