// The frame around every host screen: brand on the left, where we are in the game in
// the middle, room code and mute on the right, and a footer line. Matches the Figma.

import type { ReactNode } from "react";
import { Brand } from "@/components/ui";

type Props = {
  context: string; // middle line, e.g. "ROUND 1 / 2 · TURN 3 / 4"
  code: string;
  muted: boolean;
  onToggleMute: () => void;
  footer: string; // right side of the footer, e.g. "4 PLAYERS / 2 ROUNDS"
  children: ReactNode;
  buzz?: number; // changes every banned-word buzz, which flashes the screen edge
  hostName?: string; // who signed in with Auth0 to host (unset when sign-in is off)
};

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      {muted ? (
        <path d="m22 9-6 6m0-6 6 6" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
      )}
    </svg>
  );
}

export default function HostShell({ context, code, muted, onToggleMute, footer, children, buzz, hostName }: Props) {
  return (
    <div className="relative flex min-h-screen flex-col gap-6 px-12 pb-6 pt-[30px]">
      {/* Banned-word flash. Re-keyed on every buzz so the animation replays. */}
      {buzz ? <div key={buzz} className="pointer-events-none fixed inset-0 z-50 animate-[buzz_0.9s_ease-out]" /> : null}

      <header className="flex h-[52px] shrink-0 items-center justify-between">
        <Brand size="lg" />
        <p className="text-[15px] font-bold uppercase text-muted">{context}</p>
        <div className="flex items-center gap-3">
          {hostName && (
            <span className="mr-3 text-xs font-bold text-muted">
              Hosted by <span className="text-text">{hostName}</span> ·{" "}
              {/* A plain <a>: signing out is a full page load through Auth0, not an in-app link. */}
              <a href="/auth/logout" className="underline underline-offset-4 hover:text-text">
                Sign out
              </a>
            </span>
          )}
          {code && (
            <>
              <span className="text-xs font-extrabold text-muted">ROOM</span>
              <span className="text-2xl font-extrabold tracking-wide text-point">{code}</span>
            </>
          )}
          <button onClick={onToggleMute} className="ml-1 text-muted hover:text-text" aria-label={muted ? "Unmute sounds" : "Mute sounds"}>
            <SpeakerIcon muted={muted} />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <footer className="flex h-6 shrink-0 items-center justify-between text-xs uppercase text-dim">
        <span>Human descriptions. Artificial confidence.</span>
        <span>{footer}</span>
      </footer>
    </div>
  );
}
