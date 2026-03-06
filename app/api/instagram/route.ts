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
const ALLOWED_HOSTS = [
  "scontent",
  "fbcdn",
  "cdninstagram.com",
  "unavatar.io",
  "picuki.com",
  "imginn.com",
  "imgsed.com",
  "gramhir.com",
  "pixwox.com",
  "storiesig.info",
]

function isAllowedImageUrl(url: string): boolean {
  if (!url.startsWith("https://")) return false
  // Reject Instagram static assets (logos/icons)
  if (url.includes("/rsrc.php/") || url.includes("static.cdninstagram.com")) return false
  try {
    const host = new URL(url).hostname
    return ALLOWED_HOSTS.some((h) => host.includes(h))
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
  detail?: string
}

// Helper: extract og:image or profile pic URL from HTML
function extractImageFromHtml(html: string): string | null {
  // og:image
  const ogMatch =
    html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
  if (ogMatch?.[1] && isAllowedImageUrl(ogMatch[1])) return ogMatch[1]

  // Profile pic in JSON blobs
  const jsonPic =
    html.match(/"profile_pic_url_hd"\s*:\s*"(https?:[^"]+)"/) ??
    html.match(/"profile_pic_url"\s*:\s*"(https?:[^"]+)"/)
  if (jsonPic?.[1]) {
    const decoded = jsonPic[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
    if (isAllowedImageUrl(decoded)) return decoded
  }

  // Any <img> with scontent/fbcdn/cdninstagram src
  const imgTag = html.match(/<img[^>]+src="(https:\/\/[^"]*(?:scontent|fbcdn|cdninstagram\.com\/v)[^"]*)"/i)
  if (imgTag?.[1] && isAllowedImageUrl(imgTag[1])) return imgTag[1]

  return null
}

// ─── Strategy 1: Scrape picuki.com ───────────────────────────────────
// Picuki is a public Instagram viewer — serves profile pics to any IP.
async function strategyPicuki(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S1-picuki",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.picuki.com/profile/${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.detail = `htmlLen=${html.length}`

    // Picuki profile pic: <img class="profile-avatar" src="...">
    // or any img with profile-related class
    const avatarMatch =
      html.match(/<img[^>]+class="[^"]*profile[^"]*"[^>]+src="([^"]+)"/i) ??
      html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*profile[^"]*"/i)
    if (avatarMatch?.[1]?.startsWith("http")) {
      result.imageUrl = avatarMatch[1]
    } else {
      // Fallback: og:image
      result.imageUrl = extractImageFromHtml(html)
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 2: Scrape imginn.com (imgsed) ─────────────────────────
async function strategyImginn(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S2-imginn",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://imginn.com/${encodeURIComponent(username)}/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.detail = `htmlLen=${html.length}`

    // imginn profile pic: <img class="avatar" or userinfo area
    const avatarMatch =
      html.match(/<img[^>]+class="[^"]*avatar[^"]*"[^>]+src="([^"]+)"/i) ??
      html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*avatar[^"]*"/i) ??
      html.match(/<div[^>]+class="[^"]*userinfo[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i)
    if (avatarMatch?.[1]?.startsWith("http")) {
      result.imageUrl = avatarMatch[1]
    } else {
      result.imageUrl = extractImageFromHtml(html)
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 3: Scrape gramhir.com ─────────────────────────────────
async function strategyGramhir(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S3-gramhir",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://gramhir.com/profile/${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.detail = `htmlLen=${html.length}`

    const avatarMatch =
      html.match(/<img[^>]+class="[^"]*profile[^"]*"[^>]+src="([^"]+)"/i) ??
      html.match(/<img[^>]+class="[^"]*avatar[^"]*"[^>]+src="([^"]+)"/i) ??
      html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*profile[^"]*"/i)
    if (avatarMatch?.[1]?.startsWith("http")) {
      result.imageUrl = avatarMatch[1]
    } else {
      result.imageUrl = extractImageFromHtml(html)
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 4: unavatar.io (GET, follow redirects) ─────────────────
async function strategyUnavatar(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S4-unavatar",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    // Use GET (not HEAD) and follow redirects — check response content-type
    const url = `https://unavatar.io/instagram/${encodeURIComponent(username)}`
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    })
    result.status = res.status
    const ct = res.headers.get("content-type") || ""
    result.detail = `ct=${ct}, finalUrl=${res.url}`

    if (res.ok && ct.startsWith("image/")) {
      // It returned an actual image — use the URL directly
      result.imageUrl = url
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 5: Instagram internal API (backup) ─────────────────────
async function strategyInstagramApi(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S5-instagram-api",
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
        if (pic && isAllowedImageUrl(pic)) result.imageUrl = pic
      } catch { result.error = "JSON parse failed" }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 6: Scrape pixwox.com ───────────────────────────────────
async function strategyPixwox(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S6-pixwox",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.pixwox.com/profile/${encodeURIComponent(username)}/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.detail = `htmlLen=${html.length}`

    const avatarMatch =
      html.match(/<img[^>]+class="[^"]*avatar[^"]*"[^>]+src="([^"]+)"/i) ??
      html.match(/<img[^>]+class="[^"]*profile[^"]*"[^>]+src="([^"]+)"/i) ??
      html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*avatar[^"]*"/i)
    if (avatarMatch?.[1]?.startsWith("http")) {
      result.imageUrl = avatarMatch[1]
    } else {
      result.imageUrl = extractImageFromHtml(html)
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

const ALL_STRATEGIES = [strategyPicuki, strategyImginn, strategyGramhir, strategyUnavatar, strategyInstagramApi, strategyPixwox]

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
