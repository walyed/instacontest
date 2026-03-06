import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"

// PATCH - Mark all pending entries as "ready"
export async function PATCH(request: NextRequest) {
  try {
    const password = request.headers.get("authorization")?.replace("Bearer ", "")
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from("entries")
      .update({ status: "ready" })
      .eq("status", "pending")
      .select("id")

    if (error) {
      return NextResponse.json({ error: "Failed to update entries" }, { status: 500 })
    }

    return NextResponse.json({ success: true, updated: data?.length ?? 0 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
