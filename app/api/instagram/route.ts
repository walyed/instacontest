import { NextRequest, NextResponse } from "next/server"

// ─── Rate-limit state ────────────────────────────────────────────────
// Simple in-memory sliding-window rate limiter per IP.
// Allows MAX_REQUESTS requests per WINDOW_MS per IP.
const MAX_REQUESTS = 10
const WINDOW_MS = 60_000 // 1 minute
const hitMap = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (hitMap.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  hitMap.set(ip, hits)
  return hits.length > MAX_REQUESTS
}

// ─── Input validation ────────────────────────────────────────────────
// Instagram usernames: 1-30 chars, letters, digits, periods, underscores.
const USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/

// ─── Helper: validate extracted URL ──────────────────────────────────
function isValidInstagramImageUrl(url: string): boolean {
  return (
    url.startsWith("https://") &&
    (url.includes("instagram") ||
      url.includes("cdninstagram") ||
      url.includes("fbcdn"))
  )
}

// ─── Strategy 1: Instagram internal API ──────────────────────────────
// Uses Instagram's web_profile_info endpoint with the public web app ID.
// This returns JSON with profile data including the profile pic URL.
async function fetchViaInternalApi(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          // Instagram's public web app ID — used by instagram.com itself
          "x-ig-app-id": "936619743392459",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.instagram.com/",
          Origin: "https://www.instagram.com",
        },
        cache: "no-store",
      }
    )
    if (!res.ok) return null

    const data = await res.json()
    const picUrl =
      data?.data?.user?.profile_pic_url_hd ||
      data?.data?.user?.profile_pic_url
    if (picUrl && isValidInstagramImageUrl(picUrl)) return picUrl
    return null
  } catch {
    return null
  }
}

// ─── Strategy 2: GraphQL query ───────────────────────────────────────
// Instagram exposes a public GraphQL endpoint for user lookups.
async function fetchViaGraphQL(username: string): Promise<string | null> {
  try {
    const variables = JSON.stringify({ username, render_surface: "PROFILE" })
    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        "x-ig-app-id": "936619743392459",
        "x-requested-with": "XMLHttpRequest",
        Accept: "application/json",
        Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
      },
      cache: "no-store",
    })
    if (!res.ok) return null

    const data = await res.json()
    const picUrl =
      data?.data?.user?.profile_pic_url_hd ||
      data?.data?.user?.profile_pic_url
    if (picUrl && isValidInstagramImageUrl(picUrl)) return picUrl
    return null
  } catch {
    return null
  }
}

// ─── Strategy 3: HTML scraping with og:image ─────────────────────────
// Fetch the profile page HTML and parse the og:image meta tag.
async function fetchViaHtmlScraping(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      }
    )
    if (!res.ok) return null

    const html = await res.text()

    // Try og:image — property then content, or content then property
    const ogMatch =
      html.match(
        /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i
      ) ??
      html.match(
        /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i
      )

    if (ogMatch?.[1] && isValidInstagramImageUrl(ogMatch[1])) {
      return ogMatch[1]
    }

    // Fallback: look for profile_pic_url in embedded JSON/scripts
    const picMatch = html.match(/"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/)
      ?? html.match(/"profile_pic_url"\s*:\s*"(https:[^"]+)"/)

    if (picMatch?.[1]) {
      // Unescape JSON-encoded URL (e.g. \u0026 -> &)
      const decoded = picMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
      if (isValidInstagramImageUrl(decoded)) return decoded
    }

    return null
  } catch {
    return null
  }
}

// ─── Strategy 4: Googlebot-style fetch ───────────────────────────────
// Some sites serve richer HTML to crawlers. Try with Googlebot UA.
async function fetchViaMobileUA(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
        },
        cache: "no-store",
      }
    )
    if (!res.ok) return null

    const html = await res.text()

    const ogMatch =
      html.match(
        /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i
      ) ??
      html.match(
        /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i
      )

    if (ogMatch?.[1] && isValidInstagramImageUrl(ogMatch[1])) {
      return ogMatch[1]
    }

    return null
  } catch {
    return null
  }
}

/**
 * GET /api/instagram?username=<handle>
 *
 * Tries multiple strategies to fetch an Instagram user's profile image:
 *   1. Instagram internal API (i.instagram.com)
 *   2. Instagram web API with GraphQL
 *   3. HTML scraping with Googlebot UA
 *   4. HTML scraping with mobile UA
 *
 * All requests run server-side — no CORS issues, no client-side exposure.
 * Returns { image: "url" } on success or { error: "message" } on failure.
 */
export async function GET(request: NextRequest) {
  // ── 1. Rate-limit check ──────────────────────────────────────────
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    )
  }

  // ── 2. Read & validate the username query parameter ──────────────
  const username = request.nextUrl.searchParams
    .get("username")
    ?.trim()
    .replace(/^@/, "")

  if (!username) {
    return NextResponse.json(
      { error: "Missing required query parameter: username" },
      { status: 400 }
    )
  }

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      {
        error:
          "Invalid Instagram username. Only letters, numbers, periods, and underscores are allowed (max 30 chars).",
      },
      { status: 400 }
    )
  }

  // ── 3. Try each strategy in order until one succeeds ─────────────
  const strategies = [
    { name: "internal-api", fn: fetchViaInternalApi },
    { name: "graphql", fn: fetchViaGraphQL },
    { name: "html-scraping", fn: fetchViaHtmlScraping },
    { name: "mobile-ua", fn: fetchViaMobileUA },
  ]

  for (const strategy of strategies) {
    try {
      const imageUrl = await strategy.fn(username)
      if (imageUrl) {
        console.log(`[instagram] Fetched ${username} via ${strategy.name}`)
        return NextResponse.json({ image: imageUrl })
      }
    } catch (err) {
      console.warn(`[instagram] Strategy ${strategy.name} failed for ${username}:`, err)
    }
  }

  // ── 4. All strategies exhausted ──────────────────────────────────
  return NextResponse.json(
    {
      error:
        "Could not fetch the profile image. The profile may be private, or Instagram is blocking requests. You can upload an image manually instead.",
    },
    { status: 404 }
  )
}
