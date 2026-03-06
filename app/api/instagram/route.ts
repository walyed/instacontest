import { NextRequest, NextResponse } from "next/server"

// ─── Rate-limit state ────────────────────────────────────────────────
const MAX_REQUESTS = 15
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

// Allowlisted domains we accept as valid image sources
function isAllowedImageSource(url: string): boolean {
  if (!url.startsWith("https://")) return false
  try {
    const host = new URL(url).hostname
    return (
      host.includes("scontent") ||
      host.includes("fbcdn") ||
      host.includes("cdninstagram.com") ||
      host === "unavatar.io" ||
      host === "avatars.githubusercontent.com"
    )
  } catch {
    return false
  }
}

// ─── Debug result type ───────────────────────────────────────────────
interface StrategyResult {
  name: string
  status: number | null
  elapsedMs: number
  imageUrl: string | null
  error: string | null
  finalUrl?: string | null
  contentType?: string | null
}

// ─── Strategy 1: unavatar.io avatar proxy (primary) ──────────────────
// unavatar.io is a free open-source service that resolves social avatars.
// It handles the Instagram scraping/caching on their infrastructure.
async function strategyUnavatar(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S1-unavatar-proxy",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const url = `https://unavatar.io/instagram/${encodeURIComponent(username)}?fallback=false`
    // Use HEAD with manual redirect to check if it resolves to a real image
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
    })
    result.status = res.status

    if (res.status >= 300 && res.status < 400) {
      // Redirect — check if it redirects to a CDN URL
      const location = res.headers.get("location")
      result.finalUrl = location
      if (location && isAllowedImageSource(location)) {
        result.imageUrl = location
      } else if (location?.startsWith("https://")) {
        // Redirected to the image on some other CDN — use original unavatar URL
        result.imageUrl = `https://unavatar.io/instagram/${encodeURIComponent(username)}`
      }
    } else if (res.status === 200) {
      const ct = res.headers.get("content-type") || ""
      result.contentType = ct
      if (ct.startsWith("image/")) {
        // unavatar proxied the image directly
        result.imageUrl = `https://unavatar.io/instagram/${encodeURIComponent(username)}`
      }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 2: unavatar.io generic (tries multiple sources) ────────
async function strategyUnavatarGeneric(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S2-unavatar-generic",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const url = `https://unavatar.io/${encodeURIComponent(username)}?fallback=false`
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
    })
    result.status = res.status

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location")
      result.finalUrl = location
      if (location && isAllowedImageSource(location)) {
        result.imageUrl = location
      } else if (location?.startsWith("https://")) {
        result.imageUrl = `https://unavatar.io/${encodeURIComponent(username)}`
      }
    } else if (res.status === 200) {
      const ct = res.headers.get("content-type") || ""
      result.contentType = ct
      if (ct.startsWith("image/")) {
        result.imageUrl = `https://unavatar.io/${encodeURIComponent(username)}`
      }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 3: Instagram internal API (backup) ─────────────────────
async function strategyInstagramApi(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S3-instagram-api",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "x-ig-app-id": "936619743392459",
          Accept: "*/*",
          Referer: "https://www.instagram.com/",
          Origin: "https://www.instagram.com",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (res.ok) {
      try {
        const data = await res.json()
        const pic = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
        if (pic && isAllowedImageSource(pic)) result.imageUrl = pic
      } catch { result.error = "JSON parse failed" }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 4: Instagram web API (backup) ──────────────────────────
async function strategyInstagramWebApi(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S4-instagram-web-api",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
          "x-ig-app-id": "936619743392459",
          "x-requested-with": "XMLHttpRequest",
          Accept: "application/json",
          Referer: `https://www.instagram.com/${encodeURIComponent(username)}/`,
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (res.ok) {
      try {
        const data = await res.json()
        const pic = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
        if (pic && isAllowedImageSource(pic)) result.imageUrl = pic
      } catch { result.error = "JSON parse failed" }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

const ALL_STRATEGIES = [strategyUnavatar, strategyUnavatarGeneric, strategyInstagramApi, strategyInstagramWebApi]

/**
 * GET /api/instagram?username=<handle>
 * GET /api/instagram?username=<handle>&debug=1  (returns all strategy results)
 */
export async function GET(request: NextRequest) {
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

  const username = request.nextUrl.searchParams.get("username")?.trim().replace(/^@/, "")
  const debug = request.nextUrl.searchParams.get("debug") === "1"

  if (!username) {
    return NextResponse.json({ error: "Missing required query parameter: username" }, { status: 400 })
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ error: "Invalid Instagram username." }, { status: 400 })
  }

  // ── Debug mode: run ALL strategies and return detailed results ───
  if (debug) {
    const results: StrategyResult[] = []
    for (const fn of ALL_STRATEGIES) {
      const r = await fn(username)
      results.push(r)
    }
    const winner = results.find((r) => r.imageUrl)
    return NextResponse.json({
      username,
      serverIp: ip,
      winner: winner ? { strategy: winner.name, imageUrl: winner.imageUrl } : null,
      strategies: results,
    })
  }

  // ── Normal mode: try strategies in order, return first success ───
  for (const fn of ALL_STRATEGIES) {
    try {
      const r = await fn(username)
      if (r.imageUrl) {
        console.log(`[instagram] SUCCESS for ${username} via ${r.name} in ${r.elapsedMs}ms`)
        return NextResponse.json({ image: r.imageUrl })
      }
      console.log(`[instagram] ${r.name}: status=${r.status}, error=${r.error}`)
    } catch (err) {
      console.error(`[instagram] Exception:`, err)
    }
  }

  return NextResponse.json(
    { error: "Could not fetch the profile image. The profile may be private, or Instagram is blocking requests. You can upload an image manually instead." },
    { status: 404 }
  )
}
