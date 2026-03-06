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

function isValidInstagramImageUrl(url: string): boolean {
  return (
    url.startsWith("https://") &&
    (url.includes("instagram") ||
      url.includes("cdninstagram") ||
      url.includes("fbcdn"))
  )
}

// ─── Debug result type ───────────────────────────────────────────────
// When debug=1 is passed, we return these for every strategy.
interface StrategyResult {
  name: string
  status: number | null
  elapsedMs: number
  bodyPreview: string
  imageUrl: string | null
  error: string | null
  loginWall: boolean | null
  htmlLength: number | null
}

// ─── Strategy 1: i.instagram.com internal API ────────────────────────
async function strategy1(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S1-internal-api (i.instagram.com)",
    status: null, elapsedMs: 0, bodyPreview: "", imageUrl: null, error: null, loginWall: null, htmlLength: null,
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
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.instagram.com/",
          Origin: "https://www.instagram.com",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    const text = await res.text()
    result.bodyPreview = text.substring(0, 600)
    result.htmlLength = text.length

    if (res.ok) {
      try {
        const data = JSON.parse(text)
        const pic = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
        if (pic && isValidInstagramImageUrl(pic)) result.imageUrl = pic
      } catch { result.error = "JSON parse failed" }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 2: www.instagram.com web API ───────────────────────────
async function strategy2(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S2-web-api (www.instagram.com/api)",
    status: null, elapsedMs: 0, bodyPreview: "", imageUrl: null, error: null, loginWall: null, htmlLength: null,
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
    const text = await res.text()
    result.bodyPreview = text.substring(0, 600)
    result.htmlLength = text.length

    if (res.ok) {
      try {
        const data = JSON.parse(text)
        const pic = data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url
        if (pic && isValidInstagramImageUrl(pic)) result.imageUrl = pic
      } catch { result.error = "JSON parse failed" }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 3: HTML page with Googlebot UA ─────────────────────────
async function strategy3(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S3-html-googlebot",
    status: null, elapsedMs: 0, bodyPreview: "", imageUrl: null, error: null, loginWall: null, htmlLength: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.htmlLength = html.length
    result.bodyPreview = html.substring(0, 600)
    result.loginWall = html.includes("loginForm") || html.includes("/accounts/login")

    const ogMatch =
      html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i) ??
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i)
    if (ogMatch?.[1] && isValidInstagramImageUrl(ogMatch[1])) {
      result.imageUrl = ogMatch[1]
    } else {
      const picMatch = html.match(/"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/) ?? html.match(/"profile_pic_url"\s*:\s*"(https:[^"]+)"/)
      if (picMatch?.[1]) {
        const decoded = picMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        if (isValidInstagramImageUrl(decoded)) result.imageUrl = decoded
      }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 4: HTML page with mobile Chrome UA ─────────────────────
async function strategy4(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S4-html-mobile-chrome",
    status: null, elapsedMs: 0, bodyPreview: "", imageUrl: null, error: null, loginWall: null, htmlLength: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.htmlLength = html.length
    result.bodyPreview = html.substring(0, 600)
    result.loginWall = html.includes("loginForm") || html.includes("/accounts/login")

    const ogMatch =
      html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i) ??
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i)
    if (ogMatch?.[1] && isValidInstagramImageUrl(ogMatch[1])) {
      result.imageUrl = ogMatch[1]
    } else {
      const picMatch = html.match(/"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/) ?? html.match(/"profile_pic_url"\s*:\s*"(https:[^"]+)"/)
      if (picMatch?.[1]) {
        const decoded = picMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        if (isValidInstagramImageUrl(decoded)) result.imageUrl = decoded
      }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 5: Desktop Chrome with full realistic headers ──────────
async function strategy5(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S5-html-desktop-full-headers",
    status: null, elapsedMs: 0, bodyPreview: "", imageUrl: null, error: null, loginWall: null, htmlLength: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "max-age=0",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.htmlLength = html.length
    result.bodyPreview = html.substring(0, 600)
    result.loginWall = html.includes("loginForm") || html.includes("/accounts/login")

    const ogMatch =
      html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i) ??
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i)
    if (ogMatch?.[1] && isValidInstagramImageUrl(ogMatch[1])) {
      result.imageUrl = ogMatch[1]
    } else {
      const picMatch = html.match(/"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/) ?? html.match(/"profile_pic_url"\s*:\s*"(https:[^"]+)"/)
      if (picMatch?.[1]) {
        const decoded = picMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        if (isValidInstagramImageUrl(decoded)) result.imageUrl = decoded
      }
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

// ─── Strategy 6: Instagram embed endpoint ────────────────────────────
async function strategy6(username: string): Promise<StrategyResult> {
  const result: StrategyResult = {
    name: "S6-embed-page",
    status: null, elapsedMs: 0, bodyPreview: "", imageUrl: null, error: null, loginWall: null, htmlLength: null,
  }
  const start = Date.now()
  try {
    const res = await fetch(
      `https://www.instagram.com/${encodeURIComponent(username)}/embed/`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      }
    )
    result.status = res.status
    if (!res.ok) { result.elapsedMs = Date.now() - start; return result }

    const html = await res.text()
    result.htmlLength = html.length
    result.bodyPreview = html.substring(0, 600)

    // Look for profile pic in embed HTML — multiple patterns
    const picMatch =
      html.match(/"profile_pic_url"\s*:\s*"(https:[^"]+)"/) ??
      html.match(/class="[^"]*[Pp]rofile[^"]*"[^>]*src="([^"]+)"/) ??
      html.match(/<img[^>]+class="[^"]*"[^>]+src="(https:\/\/[^"]*(?:instagram|cdninstagram|fbcdn)[^"]*)"/)

    if (picMatch?.[1]) {
      const decoded = picMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
      if (isValidInstagramImageUrl(decoded)) result.imageUrl = decoded
    }
  } catch (err) {
    result.error = String(err)
  }
  result.elapsedMs = Date.now() - start
  return result
}

const ALL_STRATEGIES = [strategy1, strategy2, strategy3, strategy4, strategy5, strategy6]

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
      console.log(`[instagram] ${r.name}: status=${r.status}, loginWall=${r.loginWall}, htmlLen=${r.htmlLength}, error=${r.error}`)
    } catch (err) {
      console.error(`[instagram] Exception:`, err)
    }
  }

  return NextResponse.json(
    { error: "Could not fetch the profile image. The profile may be private, or Instagram is blocking requests. You can upload an image manually instead." },
    { status: 404 }
  )
}
