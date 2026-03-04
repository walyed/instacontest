import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"
import crypto from "crypto"

const MIN_REAL_IMAGE_SIZE = 5000 // bytes — filter out tiny placeholders / default icons
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// ---------------------------------------------------------------------------
// POST /api/instagram
// Accepts: { handle: string, contact?: string }
// 1. Tries to fetch the Instagram profile picture server-side
// 2. If found, uploads it to Supabase Storage and saves the entry row
// 3. Returns { success, message, imageUrl? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)

    if (!body || typeof body.handle !== "string") {
      return NextResponse.json(
        { success: false, message: "handle is required" },
        { status: 400 }
      )
    }

    const handle = body.handle.replace(/^@/, "").trim()
    const contact: string | undefined = typeof body.contact === "string" ? body.contact.trim() || undefined : undefined

    if (!handle || handle.length < 2 || !/^[a-zA-Z0-9._]{1,30}$/.test(handle)) {
      return NextResponse.json(
        { success: false, message: "Invalid Instagram handle" },
        { status: 400 }
      )
    }

    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      return NextResponse.json(
        { success: false, message: "Invalid email address" },
        { status: 400 }
      )
    }

    // ---- Try to fetch profile picture ----
    const imageBuffer = await fetchProfilePicture(handle)

    if (!imageBuffer) {
      return NextResponse.json({
        success: false,
        message: "Could not fetch Instagram profile picture. Please upload an image manually.",
      })
    }

    // ---- Upload to Supabase Storage ----
    const supabase = createServiceClient()
    const fileName = `${crypto.randomUUID()}.jpg`

    const { error: uploadError } = await supabase.storage
      .from("profile-images")
      .upload(fileName, imageBuffer.buffer, {
        contentType: imageBuffer.contentType,
        upsert: false,
      })

    if (uploadError) {
      console.error("Storage upload error:", uploadError)
      return NextResponse.json(
        { success: false, message: "Failed to store profile image" },
        { status: 500 }
      )
    }

    const { data: publicUrl } = supabase.storage
      .from("profile-images")
      .getPublicUrl(fileName)

    const imageUrl = publicUrl.publicUrl

    // ---- Insert entry row ----
    const { error: dbError } = await supabase.from("entries").insert({
      handle,
      contact: contact ?? null,
      image_url: imageUrl,
      consent: true,
      status: "pending",
    })

    if (dbError) {
      console.error("DB insert error:", dbError)
      return NextResponse.json(
        { success: false, message: "Failed to save entry" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Entry submitted successfully",
      imageUrl,
    })
  } catch (err) {
    console.error("POST /api/instagram error:", err)
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// GET /api/instagram?handle=xxx  (preview only — no DB write)
// Returns { imageUrl: string | null }
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get("handle")?.replace(/^@/, "").trim()

  if (!handle || handle.length < 2 || !/^[a-zA-Z0-9._]{1,30}$/.test(handle)) {
    return NextResponse.json({ imageUrl: null })
  }

  const img = await fetchProfilePicture(handle)
  if (!img) return NextResponse.json({ imageUrl: null })

  // Return as base64 data URL for the preview
  return NextResponse.json({
    imageUrl: `data:${img.contentType};base64,${img.buffer.toString("base64")}`,
  })
}

// ===========================================================================
// Internal helpers
// ===========================================================================

interface DownloadedImage {
  buffer: Buffer
  contentType: string
}

/** Try multiple strategies to get an Instagram profile picture. */
async function fetchProfilePicture(username: string): Promise<DownloadedImage | null> {
  // Strategy 1 – Instagram private web API (works well from cloud / Vercel IPs)
  const s1 = await tryInstagramApi(username)
  if (s1) return s1

  // Strategy 2 – i.instagram.com variant (sometimes avoids rate-limits)
  const s2 = await tryInstagramApiAlt(username)
  if (s2) return s2

  // Strategy 3 – Scrape HTML for embedded pic URLs / og:image
  const s3 = await tryInstagramScrape(username)
  if (s3) return s3

  return null
}

async function tryInstagramApi(username: string): Promise<DownloadedImage | null> {
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          "X-IG-App-ID": "936619743392459",
          Accept: "*/*",
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return null

    const data = await res.json()
    const picUrl = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
    if (!picUrl) return null

    return await downloadImage(picUrl)
  } catch {
    return null
  }
}

async function tryInstagramApiAlt(username: string): Promise<DownloadedImage | null> {
  try {
    const res = await fetch(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Instagram 275.0.0.27.98 Android",
          "X-IG-App-ID": "936619743392459",
          Accept: "*/*",
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return null

    const data = await res.json()
    const picUrl = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
    if (!picUrl) return null

    return await downloadImage(picUrl)
  } catch {
    return null
  }
}

async function tryInstagramScrape(username: string): Promise<DownloadedImage | null> {
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return null

    const html = await res.text()

    const patterns = [
      /"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/,
      /"profile_pic_url"\s*:\s*"(https:[^"]+)"/,
      /content="(https:\/\/scontent[^"]+)"\s+property="og:image"/,
      /property="og:image"\s+content="(https:\/\/scontent[^"]+)"/,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        const url = match[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        const img = await downloadImage(url)
        if (img) return img
      }
    }

    return null
  } catch {
    return null
  }
}

async function downloadImage(imageUrl: string): Promise<DownloadedImage | null> {
  try {
    const res = await fetch(imageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": USER_AGENT },
    })
    if (!res.ok) return null

    const contentType = res.headers.get("content-type") || "image/jpeg"
    if (!contentType.startsWith("image/")) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength < MIN_REAL_IMAGE_SIZE) return null

    return { buffer, contentType }
  } catch {
    return null
  }
}
