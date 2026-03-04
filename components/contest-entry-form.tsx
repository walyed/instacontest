"use client"

import { useState, useRef, type FormEvent } from "react"
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

  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setImage(file)
      const reader = new FileReader()
      reader.onloadend = () => setImagePreview(reader.result as string)
      reader.readAsDataURL(file)
      setErrors((prev) => {
        const next = { ...prev }
        delete next.image
        return next
      })
    }
  }

  function removeImage() {
    setImage(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!handle.trim()) errs.handle = "Instagram handle is required"
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) errs.contact = "Please enter a valid email"
    if (!image) errs.image = "Profile image is required"
    if (!consent) errs.consent = "You must agree to the terms"
    return errs
  }

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
      formData.append("image", image!)

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

      <div className="flex flex-col gap-2">
        <Label>Profile Image</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="sr-only"
          id="image-upload"
          aria-label="Upload profile image"
        />
        {imagePreview ? (
          <div className="relative w-full">
            <div className="relative overflow-hidden rounded-xl border border-border bg-muted aspect-square max-w-[200px]">
              <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
            </div>
            <button
              type="button"
              onClick={removeImage}
              className="absolute top-2 left-[172px] flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
              aria-label="Remove image"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <label
            htmlFor="image-upload"
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/50 py-8 transition-colors hover:border-foreground/30 hover:bg-muted"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/10">
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Click to upload your image</p>
          </label>
        )}
        {errors.image && <p className="text-sm text-destructive">{errors.image}</p>}
      </div>

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
