import { ContestEntryForm } from "@/components/contest-entry-form"
import { Trophy } from "lucide-react"

export default function HomePage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-secondary/50 px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
          <div className="mb-8 flex flex-col items-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground">
              <Trophy className="h-6 w-6 text-background" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">
              Contest Entry
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Enter your Instagram handle and upload your profile image to join the contest.
            </p>
          </div>
          <ContestEntryForm />
        </div>
      </div>
    </main>
  )
}
