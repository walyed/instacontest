import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"

// Public endpoint: returns only "ready" entries (handle + image URL)
export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("entries")
      .select("handle, image_url")
      .eq("status", "ready")
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 })
    }

    const entries = (data ?? []).map((e) => ({
      handle: e.handle,
      imageUrl: e.image_url,
    }))

    return NextResponse.json(entries, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
      },
    })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
