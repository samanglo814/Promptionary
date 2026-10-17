// The game-styled stop before Auth0's sign-in page. proxy.ts sends hosts here when they open
// /host without being signed in. Players never see it: they join with just a name.
//
// No "use client": nothing here needs the browser.

import Link from "next/link";
import { Badge, Brand, Label } from "@/components/ui";

export default function SignIn() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-8 sm:px-12">
      <Brand size="lg" />

      <div className="flex flex-1 flex-col justify-center gap-10 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-5 animate-[rise_0.5s_ease-out_both]">
          <div className="flex gap-2.5">
            <Badge tone="human">Host</Badge>
            <Badge tone="point">Big screen</Badge>
          </div>
          <h1 className="font-display text-6xl leading-[1.02] sm:text-[84px]">
            Hosting
            <br />
            tonight?
          </h1>
          <p className="max-w-md text-xl text-muted">
            Sign in to start a room. Your name shows on the big screen so everyone knows who to blame.
          </p>
        </div>

        <div
          className="flex w-full flex-col gap-4 rounded-panel border-2 border-action bg-panel p-6 sm:w-[420px]"
          style={{ animation: "rise 0.5s ease-out 150ms both" }}
        >
          <Label tone="action">Host sign-in</Label>
          <p className="text-lg">Takes ten seconds. Google works.</p>
          {/* A plain <a>, not <Link>: signing in leaves the app for Auth0 (see Auth0's notes on prefetching). */}
          <a
            href="/auth/login?returnTo=/host"
            className="flex min-h-[54px] items-center justify-center rounded-inner border-2 border-action-edge bg-action px-4 py-3.5 font-bold text-text"
          >
            Sign in to host →
          </a>
          <div className="flex items-center gap-3 text-xs text-dim">
            <span className="h-px flex-1 bg-line" />
            OR
            <span className="h-px flex-1 bg-line" />
          </div>
          <Link
            href="/play"
            className="flex min-h-[54px] items-center justify-center rounded-inner border-2 border-line bg-raised px-4 py-3.5 font-bold text-text"
          >
            Just playing? Join with a code
          </Link>
          <p className="text-center text-xs text-muted">Players never need an account.</p>
        </div>
      </div>
    </main>
  );
}
