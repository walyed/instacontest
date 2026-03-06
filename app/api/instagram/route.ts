import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"

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

function isRealProfilePicUrl(url: string): boolean {
  if (!url.startsWith("https://")) return false
  if (url.includes("/rsrc.php/") || url.includes("static.cdninstagram.com")) return false
  return (
    url.includes("scontent") ||
    url.includes("fbcdn") ||
    url.includes("cdninstagram.com/v") ||
    url.includes("web.archive.org/web/")
  )
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

// ─── Strategy 1: Simple og:image (mirrors the Python script exactly) ─
// The user's friend's Python script does: requests.get(url, headers={"User-Agent": "Mozilla/5.0"})
// then parses og:image. This works from residential IPs.
async function strategySimpleOgImage(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S1-simple-og-image",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        redirect: "follow",
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.detail = `htmlLen=${html.length}, loginWall=${html.includes("/accounts/login")}`

    // og:image — exactly what the Python script does with BeautifulSoup
    const ogMatch =
      html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
    if (ogMatch?.[1] && isRealProfilePicUrl(ogMatch[1])) {
      result.imageUrl = ogMatch[1]
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 2: Instagram Top Search API ────────────────────────────
// Instagram's search endpoint can return profile pic URLs and is
// sometimes less aggressively blocked than profile page endpoints.
async function strategyTopSearch(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S2-topsearch-api",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json",
          "x-ig-app-id": "936619743392459",
          "x-requested-with": "XMLHttpRequest",
          Referer: "https://www.instagram.com/",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const data = await res.json()
    // Find the exact username match in search results
    const users: Array<{ user: { username: string; profile_pic_url: string } }> = data?.users ?? []
    const match = users.find(
      (u) => u.user?.username?.toLowerCase() === username.toLowerCase()
    )
    if (match?.user?.profile_pic_url && isRealProfilePicUrl(match.user.profile_pic_url)) {
      result.imageUrl = match.user.profile_pic_url
    }
    result.detail = `usersFound=${users.length}`
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 3: Instagram internal API ──────────────────────────────
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
          "User-Agent": "Instagram 275.0.0.27.98 Android",
          "x-ig-app-id": "936619743392459",
          Accept: "*/*",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (res.ok) {
      try {
        const data = await res.json()
        const pic = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
        if (pic && isRealProfilePicUrl(pic)) result.imageUrl = pic
      } catch { result.error = "JSON parse failed" }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 4: unavatar.io with image download + validation ────────
async function strategyUnavatar(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S4-unavatar",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const url = `https://unavatar.io/instagram/${encodeURIComponent(username)}?fallback=false`
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "image/*,*/*;q=0.8" },
    })
    result.status = res.status
    const ct = res.headers.get("content-type") || ""

    if (res.ok && ct.startsWith("image/")) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      const size = bytes.byteLength
      result.detail = `ct=${ct}, size=${size}`

      // Check if image is the Instagram logo by reading PNG header for dimensions
      // PNG: bytes 16-19 = width, bytes 20-23 = height (big-endian)
      let isPng = bytes[0] === 0x89 && bytes[1] === 0x50 // PNG magic
      let width = 0
      let height = 0
      if (isPng && bytes.length > 24) {
        width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
        height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
        result.detail += `, png=${width}x${height}`
      }

      // Real Instagram profile pics: 150x150, 320x320, 640x640, etc.
      // Instagram logo from unavatar is typically a non-square or very specific size
      // Reject if too small or if the final URL redirected to a generic fallback
      const finalUrl = res.url
      const isFallback =
        finalUrl.includes("fallback") ||
        finalUrl.includes("default") ||
        finalUrl.includes("placeholder")

      if (size > 5000 && !isFallback) {
        result.imageUrl = `https://unavatar.io/instagram/${encodeURIComponent(username)}`
      } else {
        result.error = `Rejected: size=${size}, isFallback=${isFallback}`
      }
    } else {
      result.detail = `ct=${ct}`
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// Helper: decode HTML entities in URLs
function decodeHtmlEntities(url: string): string {
  return url
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

// Helper: extract og:image from HTML
function extractOgImage(html: string): string | null {
  const ogMatch =
    html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
  if (!ogMatch?.[1]) return null
  const decoded = decodeHtmlEntities(ogMatch[1])
  return isRealProfilePicUrl(decoded) ? decoded : null
}

// Helper: extract profile_pic_url from embedded JSON in HTML
function extractProfilePicFromScript(html: string): string | null {
  const picMatch = html.match(/"profile_pic_url_hd"\s*:\s*"([^"]+)"/) ??
                   html.match(/"profile_pic_url"\s*:\s*"([^"]+)"/)
  if (picMatch?.[1]) {
    const decoded = decodeHtmlEntities(picMatch[1].replace(/\\u0026/g, "&").replace(/\\\/\//g, "/"))
    if (isRealProfilePicUrl(decoded)) return decoded
  }
  return null
}

// ─── Strategy: Self-hosted residential proxy ─────────────────────────
// Calls the user's local Python proxy (exposed via Cloudflare Tunnel).
// This is the most reliable strategy because it uses a residential IP.
// Requires IG_PROXY_URL env var set to the tunnel URL.
async function strategyLocalProxy(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "local-proxy",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const proxyUrl = process.env.IG_PROXY_URL
  if (!proxyUrl) {
    result.error = "IG_PROXY_URL not configured"
    return result
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `${proxyUrl}/api/instagram?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "x-proxy-secret": "instacontest-proxy-2026",
          Accept: "application/json",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const data = await res.json()
    result.detail = `error=${data.error ?? "none"}`
    if (data.image && isRealProfilePicUrl(data.image)) {
      result.imageUrl = data.image
    } else if (data.image) {
      result.detail += `, imgUrl=${data.image.substring(0, 80)}`
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy: Google Cache ──────────────────────────────────────────
// Google's cache serves pages that were crawled by Googlebot.
// Instagram allows Googlebot, so cached pages contain real og:image.
async function strategyGoogleCache(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "google-cache",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:https://www.instagram.com/${encodeURIComponent(username)}/`
    const res = await fetch(cacheUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
      cache: "no-store",
    })
    result.status = res.status
    if (res.ok) {
      const html = await res.text()
      result.detail = `htmlLen=${html.length}`
      const img = extractOgImage(html) ?? extractProfilePicFromScript(html)
      if (img) result.imageUrl = img
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy: Wayback Machine ───────────────────────────────────────
// Fetches the most recent archived version of the Instagram profile page.
// Extracts the profile pic CDN URL, then tries to download the image
// through the Wayback Machine im_ proxy. If successful, uploads the
// image to Supabase storage and returns a permanent URL.
async function strategyWaybackMachine(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "wayback",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    // Step 1: Find the most recent snapshot
    const cdxUrl = `https://archive.org/wayback/available?url=instagram.com/${encodeURIComponent(username)}/`
    const cdxRes = await fetch(cdxUrl, { cache: "no-store" })
    result.status = cdxRes.status
    if (!cdxRes.ok) { result.elapsedMs = Date.now() - start; return result }

    const cdxData = await cdxRes.json()
    const snapshot = cdxData?.archived_snapshots?.closest
    if (!snapshot?.url) {
      result.detail = "no snapshot found"
      result.elapsedMs = Date.now() - start
      return result
    }

    result.detail = `snapshot=${snapshot.timestamp}`

    // Step 2: Fetch the archived profile HTML page
    const archiveUrl: string = snapshot.url.replace("http://", "https://")
    const res = await fetch(archiveUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      cache: "no-store",
    })
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.detail += `, htmlLen=${html.length}`
    const cdnUrl = extractOgImage(html) ?? extractProfilePicFromScript(html)
    if (!cdnUrl) { result.elapsedMs = Date.now() - start; return result }

    result.detail += `, cdnUrl=${cdnUrl.substring(0, 80)}`

    // Step 3: Build Wayback image proxy URL and try to download the image
    // The im_ prefix tells Wayback to serve raw image bytes
    const waybackImgUrl = `https://web.archive.org/web/${snapshot.timestamp}im_/${cdnUrl}`
    let imgBuffer: Buffer | null = null
    let imgContentType = "image/jpeg"

    const imgRes = await fetch(waybackImgUrl, {
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "image/*,*/*;q=0.8" },
    })
    const imgCt = imgRes.headers.get("content-type") || ""
    result.detail += `, imgProxy=${imgRes.status},ct=${imgCt}`

    if (imgRes.ok && imgCt.startsWith("image/")) {
      imgBuffer = Buffer.from(await imgRes.arrayBuffer())
      imgContentType = imgCt.split(";")[0]
    }

    // If Wayback proxy failed, try the CDN URL directly (might work for recent snapshots)
    if (!imgBuffer) {
      try {
        const directRes = await fetch(cdnUrl, {
          redirect: "follow",
          cache: "no-store",
          headers: { Accept: "image/*,*/*;q=0.8" },
        })
        const directCt = directRes.headers.get("content-type") || ""
        result.detail += ` | direct=${directRes.status},ct=${directCt}`
        if (directRes.ok && directCt.startsWith("image/")) {
          imgBuffer = Buffer.from(await directRes.arrayBuffer())
          imgContentType = directCt.split(";")[0]
        }
      } catch { /* ignore */ }
    }

    // Step 4: Upload to Supabase storage if we got image bytes
    if (imgBuffer && imgBuffer.length > 1000) {
      try {
        const supabase = createServiceClient()
        const ext = imgContentType.includes("png") ? "png" : "jpg"
        const fileName = `ig-${username}-${Date.now()}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from("profile-images")
          .upload(fileName, imgBuffer, { contentType: imgContentType, upsert: false })

        if (!uploadError) {
          const { data: publicUrl } = supabase.storage
            .from("profile-images")
            .getPublicUrl(fileName)
          result.imageUrl = publicUrl.publicUrl
          result.detail += `, uploaded=${fileName}`
        } else {
          result.detail += `, uploadErr=${uploadError.message}`
        }
      } catch (err) {
        result.detail += `, supabaseErr=${String(err)}`
      }
    }

    // If upload failed, return the CDN URL as a fallback
    if (!result.imageUrl && cdnUrl) {
      result.imageUrl = cdnUrl
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy: Instagram Embed page ──────────────────────────────────
// The /embed/ endpoint is designed for third-party embedding and may
// have different blocking rules. Contains profile pic in the HTML.
async function strategyEmbed(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "embed",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/embed/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
        redirect: "follow",
        cache: "no-store",
      }
    )
    result.status = res.status
    if (res.ok) {
      const html = await res.text()
      result.detail = `htmlLen=${html.length}, loginWall=${html.includes("/accounts/login")}`
      // Embed pages have profile pics in img tags or JSON
      const img = extractOgImage(html) ?? extractProfilePicFromScript(html)
      if (img) { result.imageUrl = img }
      // Also check for img tags with profile pic class
      if (!img) {
        const imgTag = html.match(/<img[^>]+class="[^"]*(?:avatar|profile)[^"]*"[^>]+src="([^"]+)"/i) ??
                       html.match(/<img[^>]+src="(https:\/\/[^"]*scontent[^"]+)"/i)
        if (imgTag?.[1] && isRealProfilePicUrl(imgTag[1])) {
          result.imageUrl = imgTag[1]
        }
      }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy: allorigins.win CORS proxy ─────────────────────────────
async function strategyAllOrigins(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "allorigins",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const targetUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`
    const res = await fetch(
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      { cache: "no-store" }
    )
    result.status = res.status
    if (res.ok) {
      const html = await res.text()
      result.detail = `htmlLen=${html.length}, loginWall=${html.includes("/accounts/login")}`
      const img = extractOgImage(html) ?? extractProfilePicFromScript(html)
      if (img) result.imageUrl = img
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy: ScraperAPI datacenter proxy ───────────────────────────
async function strategyScraperProxy(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "scraper-proxy",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const apiKey = process.env.SCRAPER_API_KEY
  if (!apiKey) { result.error = "SCRAPER_API_KEY not set"; return result }
  const start = Date.now()
  const targetUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`

  // Standard datacenter proxy (1 credit)
  try {
    const res = await fetch(
      `https://api.scraperapi.com/?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(targetUrl)}`,
      { cache: "no-store" }
    )
    result.status = res.status
    if (res.ok) {
      const html = await res.text()
      result.detail = `htmlLen=${html.length}, loginWall=${html.includes("/accounts/login")}`
      const img = extractOgImage(html) ?? extractProfilePicFromScript(html)
      if (img) { result.imageUrl = img; result.elapsedMs = Date.now() - start; return result }
    } else {
      result.detail = `status=${res.status}`
    }
  } catch (err) {
    result.detail = `err: ${String(err)}`
  }

  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy: Microlink with prerender ──────────────────────────────
async function strategyMicrolink(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "microlink",
    status: null, elapsedMs: 0, imageUrl: null, error: null,
  }
  const start = Date.now()
  try {
    const targetUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`
    const res = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(targetUrl)}&prerender=true&meta=true`,
      { cache: "no-store" }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }
    const data = await res.json()
    result.detail = `mlStatus=${data.status}`
    if (data.status === "success") {
      const imgUrl = data.data?.image?.url
      if (imgUrl && isRealProfilePicUrl(imgUrl)) {
        result.imageUrl = imgUrl
      } else {
        result.detail += `, imgUrl=${imgUrl?.substring(0, 100) ?? "none"}`
      }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

const ALL_STRATEGIES = [
  strategyLocalProxy,     // Self-hosted residential proxy (most reliable)
  strategyGoogleCache,    // Google's cached version
  strategyWaybackMachine, // Wayback Machine archived version
  strategyEmbed,          // Instagram embed endpoint
  strategyAllOrigins,     // allorigins.win CORS proxy
  strategyScraperProxy,   // ScraperAPI datacenter proxy
  strategyMicrolink,      // Microlink with prerender
  strategySimpleOgImage,  // Direct og:image
  strategyInstagramApi,   // Direct Instagram API
]

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
