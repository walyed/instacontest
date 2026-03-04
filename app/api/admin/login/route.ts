import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json()

    if (password === process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Incorrect password" }, { status: 401 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
