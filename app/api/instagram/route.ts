import { NextRequest, NextResponse } from "next/server"

const MIN_REAL_IMAGE_SIZE = 5000 // 5KB — filter out tiny placeholders

export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get("handle")

  if (!handle) {
    return NextResponse.json({ imageUrl: null })
  }

  const cleanHandle = handle.replace(/^@/, "").trim()

  if (!cleanHandle || cleanHandle.length < 2) {
    return NextResponse.json({ imageUrl: null })
  }

  if (!/^[a-zA-Z0-9._]{1,30}$/.test(cleanHandle)) {
    return NextResponse.json({ imageUrl: null })
  }

  // Strategy 1: Instagram's web_profile_info API
  // This works from most server/cloud IPs but may be rate-limited from residential IPs
  const igPfp = await tryInstagramApi(cleanHandle)
  if (igPfp) {
    return NextResponse.json({ imageUrl: igPfp })
  }

  // Strategy 2: Scrape Instagram profile page for embedded profile pic data
  const scrapedPfp = await tryInstagramScrape(cleanHandle)
  if (scrapedPfp) {
    return NextResponse.json({ imageUrl: scrapedPfp })
  }

  return NextResponse.json({ imageUrl: null })
}

async function tryInstagramApi(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "X-IG-App-ID": "936619743392459",
          Accept: "*/*",
        },
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!res.ok) return null

    const data = await res.json()
    const picUrl =
      data?.data?.user?.profile_pic_url_hd || data?.data?.user?.profile_pic_url

    if (!picUrl) return null

    // Download and convert to base64 (IG CDN URLs expire, so we need to store the actual image)
    return await downloadAsDataUrl(picUrl)
  } catch {
    return null
  }
}

async function tryInstagramScrape(username: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return null

    const html = await res.text()

    // Try to find profile pic URL in the page source
    const patterns = [
      /"profile_pic_url_hd"\s*:\s*"(https:[^"]+)"/,
      /"profile_pic_url"\s*:\s*"(https:[^"]+)"/,
      /content="(https:\/\/scontent[^"]+)" property="og:image"/,
      /property="og:image" content="(https:\/\/scontent[^"]+)"/,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        // Unescape JSON-encoded URL
        const url = match[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/")
        return await downloadAsDataUrl(url)
      }
    }

    return null
  } catch {
    return null
  }
}

async function downloadAsDataUrl(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    })

    if (!res.ok) return null

    const contentType = res.headers.get("content-type") || ""
    if (!contentType.startsWith("image/")) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength < MIN_REAL_IMAGE_SIZE) return null

    return `data:${contentType};base64,${buffer.toString("base64")}`
  } catch {
    return null
  }
}
