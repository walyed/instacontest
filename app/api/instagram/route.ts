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

/**
 * GET /api/instagram?username=<handle>
 *
 * Fetches the public Instagram profile page for the given username,
 * extracts the og:image meta tag (which contains the profile picture),
 * and returns it as JSON.
 *
 * This runs entirely server-side so there are no CORS issues —
 * the browser never contacts Instagram directly.
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
    .replace(/^@/, "") // strip leading "@" for convenience

  if (!username) {
    return NextResponse.json(
      { error: "Missing required query parameter: username" },
      { status: 400 }
    )
  }

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Invalid Instagram username. Only letters, numbers, periods, and underscores are allowed (max 30 chars)." },
      { status: 400 }
    )
  }

  try {
    // ── 3. Fetch the Instagram profile page from the server ────────
    // Using a realistic browser User-Agent helps avoid immediate blocking.
    const igUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`

    const response = await fetch(igUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      // Prevent Next.js from caching the response
      cache: "no-store",
    })

    // ── 4. Handle non-OK responses from Instagram ──────────────────
    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: `Instagram user "${username}" not found.` },
          { status: 404 }
        )
      }
      if (response.status === 429) {
        return NextResponse.json(
          { error: "Instagram is rate-limiting this server. Please try again later." },
          { status: 502 }
        )
      }
      return NextResponse.json(
        { error: `Instagram returned HTTP ${response.status}.` },
        { status: 502 }
      )
    }

    // ── 5. Read the HTML and extract the og:image meta tag ─────────
    const html = await response.text()

    // Try <meta property="og:image" content="..." />
    // The regex handles both single and double quotes, and different attribute orders.
    const ogMatch = html.match(
      /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i
    ) ?? html.match(
      /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i
    )

    if (!ogMatch?.[1]) {
      // og:image not found — this usually means the profile is private
      // or Instagram served a login-wall page.
      return NextResponse.json(
        {
          error:
            "Could not extract the profile image. The profile may be private or Instagram blocked the request.",
        },
        { status: 404 }
      )
    }

    const imageUrl = ogMatch[1]

    // ── 6. Basic sanity check on the extracted URL ─────────────────
    // Make sure it looks like a real image URL from Instagram's CDN.
    if (
      !imageUrl.startsWith("https://") ||
      !(
        imageUrl.includes("instagram") ||
        imageUrl.includes("cdninstagram") ||
        imageUrl.includes("fbcdn")
      )
    ) {
      return NextResponse.json(
        { error: "Extracted URL does not appear to be a valid Instagram image." },
        { status: 502 }
      )
    }

    // ── 7. Return the image URL ────────────────────────────────────
    return NextResponse.json({ image: imageUrl })
  } catch (err) {
    console.error("Instagram fetch error:", err)
    return NextResponse.json(
      { error: "Failed to fetch Instagram profile. Please try again later." },
      { status: 500 }
    )
  }
}
