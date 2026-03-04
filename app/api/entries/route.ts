import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"
import crypto from "crypto"

// POST - Fallback: submit entry with a manually-uploaded image (multipart/form-data)
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const formData = await request.formData()

    const handle = (formData.get("handle") as string)?.trim()
    const contact = (formData.get("contact") as string | null)?.trim() || null
    const imageFile = formData.get("image") as File | null

    if (!handle) {
      return NextResponse.json({ success: false, message: "Instagram handle is required" }, { status: 400 })
    }
    if (!imageFile || imageFile.size === 0) {
      return NextResponse.json({ success: false, message: "Profile image is required" }, { status: 400 })
    }
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      return NextResponse.json({ success: false, message: "Invalid email" }, { status: 400 })
    }

    // Upload to Supabase Storage
    const ext = imageFile.name.split(".").pop()?.toLowerCase() || "jpg"
    const safeExt = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext) ? ext : "jpg"
    const fileName = `${crypto.randomUUID()}.${safeExt}`
    const buffer = Buffer.from(await imageFile.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from("profile-images")
      .upload(fileName, buffer, { contentType: imageFile.type, upsert: false })

    if (uploadError) {
      console.error("Storage upload error:", uploadError)
      return NextResponse.json({ success: false, message: "Failed to upload image" }, { status: 500 })
    }

    const { data: publicUrl } = supabase.storage
      .from("profile-images")
      .getPublicUrl(fileName)

    // Insert entry row
    const { error: dbError } = await supabase.from("entries").insert({
      handle: handle.replace(/^@/, ""),
      contact,
      image_url: publicUrl.publicUrl,
      consent: true,
      status: "pending",
    })

    if (dbError) {
      console.error("DB insert error:", dbError)
      return NextResponse.json({ success: false, message: "Failed to save entry" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: "Entry submitted successfully",
      imageUrl: publicUrl.publicUrl,
    })
  } catch (err) {
    console.error("POST /api/entries error:", err)
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 })
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
