// The frame around every phone screen: brand on the left, round and room on the right.
// Matches the phone frames in the Figma design.

import type { ReactNode } from "react";
import { Brand } from "@/components/ui";

export default function PhoneShell({ context, children }: { context?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-6">
        <Brand />
        {context && <span className="text-[11px] font-extrabold uppercase text-point">{context}</span>}
      </header>
      <main className="flex flex-1 flex-col gap-3 px-6 pb-6 pt-3.5">{children}</main>
    </div>
  );
}
