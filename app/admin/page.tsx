"use client"

import { useState } from "react"
import { AdminLogin } from "@/components/admin-login"
import { AdminDashboard } from "@/components/admin-dashboard"

export default function AdminPage() {
  const [adminPassword, setAdminPassword] = useState<string | null>(null)

  if (!adminPassword) {
    return <AdminLogin onLogin={(password) => setAdminPassword(password)} />
  }

  return <AdminDashboard password={adminPassword} onLogout={() => setAdminPassword(null)} />
}
