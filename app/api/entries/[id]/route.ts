import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase-server"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const password = request.headers.get("authorization")?.replace("Bearer ", "")
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { status } = body

    if (!["pending", "ready"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { error } = await supabase
      .from("entries")
      .update({ status })
      .eq("id", id)

    if (error) {
      return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const password = request.headers.get("authorization")?.replace("Bearer ", "")
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const supabase = createServiceClient()

    // Get entry to find the image file name
    const { data: entry } = await supabase
      .from("entries")
      .select("image_url")
      .eq("id", id)
      .single()

    // Delete the image from storage if it exists
    if (entry?.image_url) {
      const fileName = entry.image_url.split("/").pop()
      if (fileName) {
        await supabase.storage.from("profile-images").remove([fileName])
      }
    }

    // Delete the database row
    const { error } = await supabase.from("entries").delete().eq("id", id)
    if (error) {
      return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
