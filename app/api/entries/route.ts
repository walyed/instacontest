import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"
import crypto from "crypto"

// POST - Create a new entry (public)
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const formData = await request.formData()

    const handle = formData.get("handle") as string
    const contact = formData.get("contact") as string | null
    const consent = formData.get("consent") === "true"
    const imageFile = formData.get("image") as File | null
    const imageUrl = formData.get("imageUrl") as string | null

    if (!handle?.trim()) {
      return NextResponse.json({ error: "Social handle is required" }, { status: 400 })
    }
    if (!consent) {
      return NextResponse.json({ error: "Consent is required" }, { status: 400 })
    }
    if (!imageFile && !imageUrl) {
      return NextResponse.json({ error: "Profile image is required" }, { status: 400 })
    }
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 })
    }

    let storedImageUrl: string

    if (imageFile) {
      const ext = imageFile.name.split(".").pop()?.toLowerCase() || "jpg"
      const safeExt = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext) ? ext : "jpg"
      const fileName = `${crypto.randomUUID()}.${safeExt}`
      const buffer = Buffer.from(await imageFile.arrayBuffer())

      const { error: uploadError } = await supabase.storage
        .from("profile-images")
        .upload(fileName, buffer, {
          contentType: imageFile.type,
          upsert: false,
        })

      if (uploadError) {
        return NextResponse.json({ error: "Failed to upload image" }, { status: 500 })
      }

      const { data: publicUrl } = supabase.storage
        .from("profile-images")
        .getPublicUrl(fileName)

      storedImageUrl = publicUrl.publicUrl
    } else if (imageUrl) {
      // Handle base64 data URL from auto-fetch
      const dataUrlMatch = imageUrl.match(/^data:(image\/(jpeg|png|gif|webp));base64,(.+)$/)
      if (!dataUrlMatch) {
        return NextResponse.json({ error: "Invalid image data" }, { status: 400 })
      }

      const contentType = dataUrlMatch[1]
      const ext = dataUrlMatch[2] === "jpeg" ? "jpg" : dataUrlMatch[2]
      const base64Data = dataUrlMatch[3]
      const fileName = `${crypto.randomUUID()}.${ext}`
      const buffer = Buffer.from(base64Data, "base64")

      const { error: uploadError } = await supabase.storage
        .from("profile-images")
        .upload(fileName, buffer, {
          contentType,
          upsert: false,
        })

      if (uploadError) {
        return NextResponse.json({ error: "Failed to store image" }, { status: 500 })
      }

      const { data: publicUrl } = supabase.storage
        .from("profile-images")
        .getPublicUrl(fileName)

      storedImageUrl = publicUrl.publicUrl
    } else {
      return NextResponse.json({ error: "Image is required" }, { status: 400 })
    }

    const { error: dbError } = await supabase.from("entries").insert({
      handle: handle.trim(),
      contact: contact?.trim() || null,
      image_url: storedImageUrl,
      consent: true,
      status: "pending",
    })

    if (dbError) {
      return NextResponse.json({ error: "Failed to save entry" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// GET - List all entries (admin only)
export async function GET(request: NextRequest) {
  try {
    const password = request.headers.get("authorization")?.replace("Bearer ", "")
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("entries")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 })
    }

    const entries = (data ?? []).map((e) => ({
      id: e.id,
      handle: e.handle,
      contact: e.contact || undefined,
      imageUrl: e.image_url,
      status: e.status,
      createdAt: e.created_at,
    }))

    return NextResponse.json(entries)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
