import { NextRequest, NextResponse } from "next/server"

// ─── Rate-limit state ────────────────────────────────────────────────
const MAX_REQUESTS = 10
const WINDOW_MS = 60_000
const hitMap = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (hitMap.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  hitMap.set(ip, hits)
  return hits.length > MAX_REQUESTS
}

const USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/

function isValidInstagramImageUrl(url: string): boolean {
  return (
    url.startsWith("https://") &&
    (url.includes("instagram") ||
      url.includes("cdninstagram") ||
      url.includes("fbcdn"))
  )
}

// ─── Strategy 1: Instagram internal API (i.instagram.com) ────────────
async function fetchViaInternalApi(username: string): Promise<string | null> {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  console.log(`[S1-internal-api] Fetching: ${url}`)

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "x-ig-app-id": "936619743392459",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.instagram.com/",
        Origin: "https://www.instagram.com",
      },
      cache: "no-store",
    })

    console.log(`[S1-internal-api] Response status: ${res.status} ${res.statusText}`)
    console.log(`[S1-internal-api] Response headers: content-type=${res.headers.get("content-type")}`)

    if (!res.ok) {
      const body = await res.text()
      console.log(`[S1-internal-api] Error body (first 500 chars): ${body.substring(0, 500)}`)
      return null
    }

    const text = await res.text()
    console.log(`[S1-internal-api] Response body (first 500 chars): ${text.substring(0, 500)}`)

    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.log(`[S1-internal-api] Failed to parse JSON`)
      return null
    }

    const picUrl = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
    console.log(`[S1-internal-api] Extracted pic URL: ${picUrl || "NONE"}`)

    if (picUrl && isValidInstagramImageUrl(picUrl)) return picUrl
    return null
  } catch (err) {
    console.error(`[S1-internal-api] Exception:`, err)
    return null
  }
}

// ─── Strategy 2: www.instagram.com API (mobile UA) ───────────────────
async function fetchViaWebApi(username: string): Promise<string | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  console.log(`[S2-web-api] Fetching: ${url}`)

  try {
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

    console.log(`[S2-web-api] Response status: ${res.status} ${res.statusText}`)
    console.log(`[S2-web-api] Response headers: content-type=${res.headers.get("content-type")}`)

    if (!res.ok) {
      const body = await res.text()
      console.log(`[S2-web-api] Error body (first 500 chars): ${body.substring(0, 500)}`)
      return null
    }

    const text = await res.text()
    console.log(`[S2-web-api] Response body (first 500 chars): ${text.substring(0, 500)}`)

    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.log(`[S2-web-api] Failed to parse JSON`)
      return null
    }

    const picUrl = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
    console.log(`[S2-web-api] Extracted pic URL: ${picUrl || "NONE"}`)

    if (picUrl && isValidInstagramImageUrl(picUrl)) return picUrl
    return null
  } catch (err) {
    console.error(`[S2-web-api] Exception:`, err)
    return null
  }
}

// ─── Strategy 3: HTML scraping (Googlebot UA) ────────────────────────
async function fetchViaHtmlScraping(username: string): Promise<string | null> {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`
  console.log(`[S3-html-googlebot] Fetching: ${url}`)

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      cache: "no-store",
    })

    console.log(`[S3-html-googlebot] Response status: ${res.status} ${res.statusText}`)
    console.log(`[S3-html-googlebot] Response headers: content-type=${res.headers.get("content-type")}`)

    if (!res.ok) {
      console.log(`[S3-html-googlebot] Non-OK status, skipping`)
      return null
    }

    const html = await res.text()
    console.log(`[S3-html-googlebot] HTML length: ${html.length}`)
    console.log(`[S3-html-googlebot] HTML first 800 chars: ${html.substring(0, 800)}`)

    // Check if it's a login wall
    const hasLoginForm = html.includes("loginForm") || html.includes("/accounts/login")
    console.log(`[S3-html-googlebot] Contains login wall: ${hasLoginForm}`)

    // Look for og:image
    const ogMatch =
      html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i) ??
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i)

    console.log(`[S3-html-googlebot] og:image match: ${ogMatch?.[1] || "NONE"}`)

    if (ogMatch?.[1] && isValidInstagramImageUrl(ogMatch[1])) {
      return ogMatch[1]
    }

    // Look for profile_pic_url in embedded JSON
    const picMatch =
      html.match(/"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/) ??
      html.match(/"profile_pic_url"\s*:\s*"(https:[^"]+)"/)

    console.log(`[S3-html-googlebot] JSON profile_pic match: ${picMatch?.[1]?.substring(0, 100) || "NONE"}`)

    if (picMatch?.[1]) {
      const decoded = picMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
      if (isValidInstagramImageUrl(decoded)) return decoded
    }

    return null
  } catch (err) {
    console.error(`[S3-html-googlebot] Exception:`, err)
    return null
  }
}

// ─── Strategy 4: HTML scraping (mobile Chrome UA) ────────────────────
async function fetchViaMobileUA(username: string): Promise<string | null> {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`
  console.log(`[S4-html-mobile] Fetching: ${url}`)

  try {
    const res = await fetch(url, {
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
    })

    console.log(`[S4-html-mobile] Response status: ${res.status} ${res.statusText}`)

    if (!res.ok) {
      console.log(`[S4-html-mobile] Non-OK status, skipping`)
      return null
    }

    const html = await res.text()
    console.log(`[S4-html-mobile] HTML length: ${html.length}`)
    console.log(`[S4-html-mobile] HTML first 800 chars: ${html.substring(0, 800)}`)

    const hasLoginForm = html.includes("loginForm") || html.includes("/accounts/login")
    console.log(`[S4-html-mobile] Contains login wall: ${hasLoginForm}`)

    const ogMatch =
      html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i) ??
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i)

    console.log(`[S4-html-mobile] og:image match: ${ogMatch?.[1] || "NONE"}`)

    if (ogMatch?.[1] && isValidInstagramImageUrl(ogMatch[1])) {
      return ogMatch[1]
    }

    // Also try embedded JSON
    const picMatch =
      html.match(/"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/) ??
      html.match(/"profile_pic_url"\s*:\s*"(https:[^"]+)"/)

    console.log(`[S4-html-mobile] JSON profile_pic match: ${picMatch?.[1]?.substring(0, 100) || "NONE"}`)

    if (picMatch?.[1]) {
      const decoded = picMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
      if (isValidInstagramImageUrl(decoded)) return decoded
    }

    return null
  } catch (err) {
    console.error(`[S4-html-mobile] Exception:`, err)
    return null
  }
}

/**
 * GET /api/instagram?username=<handle>
 *
 * Tries 4 strategies in order. Detailed logs for Vercel Function Logs.
 */
export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"

  console.log(`[instagram] ===== New request from IP: ${ip} =====`)

  if (isRateLimited(ip)) {
    console.log(`[instagram] Rate limited IP: ${ip}`)
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    )
  }

  const username = request.nextUrl.searchParams
    .get("username")
    ?.trim()
    .replace(/^@/, "")

  console.log(`[instagram] Username requested: "${username}"`)

  if (!username) {
    return NextResponse.json(
      { error: "Missing required query parameter: username" },
      { status: 400 }
    )
  }

  if (!USERNAME_RE.test(username)) {
    console.log(`[instagram] Invalid username format: "${username}"`)
    return NextResponse.json(
      { error: "Invalid Instagram username." },
      { status: 400 }
    )
  }

  const strategies = [
    { name: "S1-internal-api", fn: fetchViaInternalApi },
    { name: "S2-web-api", fn: fetchViaWebApi },
    { name: "S3-html-googlebot", fn: fetchViaHtmlScraping },
    { name: "S4-html-mobile", fn: fetchViaMobileUA },
  ]

  for (const strategy of strategies) {
    console.log(`[instagram] ── Trying strategy: ${strategy.name} ──`)
    const start = Date.now()

    try {
      const imageUrl = await strategy.fn(username)
      const elapsed = Date.now() - start
      console.log(`[instagram] ${strategy.name} took ${elapsed}ms, result: ${imageUrl ? "SUCCESS" : "FAIL"}`)

      if (imageUrl) {
        console.log(`[instagram] ✅ SUCCESS via ${strategy.name}: ${imageUrl.substring(0, 120)}...`)
        return NextResponse.json({ image: imageUrl })
      }
    } catch (err) {
      const elapsed = Date.now() - start
      console.error(`[instagram] ${strategy.name} EXCEPTION after ${elapsed}ms:`, err)
    }
  }

  console.log(`[instagram] ❌ ALL 4 STRATEGIES FAILED for username: ${username}`)
  return NextResponse.json(
    {
      error:
        "Could not fetch the profile image. The profile may be private, or Instagram is blocking requests. You can upload an image manually instead.",
    },
    { status: 404 }
  )
}
