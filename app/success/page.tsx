import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CircleCheck } from "lucide-react"

export default function SuccessPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-secondary/50 px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card p-10 text-center shadow-lg">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CircleCheck className="h-8 w-8 text-emerald-600" />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">
              Entry Submitted
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Thanks for entering! Winners will be announced soon.
            </p>
          </div>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href="/">Submit another entry</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
