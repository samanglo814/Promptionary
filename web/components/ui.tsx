// The small pieces every screen is built from, matching the Figma design.
// No "use client": nothing here has state. The pages that use them are client components.

import type { ButtonHTMLAttributes, ReactNode } from "react";

// The three accent colors, and what each one means (see globals.css).
export type Tone = "human" | "ai" | "point" | "action" | "line";

const textTone: Record<Tone, string> = {
  human: "text-human",
  ai: "text-ai",
  point: "text-point",
  action: "text-action-edge",
  line: "text-muted",
};

const borderTone: Record<Tone, string> = {
  human: "border-human",
  ai: "border-ai",
  point: "border-point",
  action: "border-action",
  line: "border-line",
};

// The four-point sparkle next to the name. Drawn here so there's no image to load.
function Sparkle({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z"
        stroke="var(--color-point)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M19 16.5c.2 1.6 1 2.4 2.5 2.5-1.6.2-2.4 1-2.5 2.5-.2-1.6-1-2.4-2.5-2.5 1.6-.2 2.4-1 2.5-2.5Z" fill="var(--color-point)" />
    </svg>
  );
}

// "✦ Promptionary". size="lg" on the host, "md" on phones.
export function Brand({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <div className="flex items-center gap-2.5">
      <Sparkle size={size === "lg" ? 28 : 21} />
      <span className={`font-display leading-none ${size === "lg" ? "text-[34px]" : "text-[26px]"}`}>Promptionary</span>
    </div>
  );
}

// Small all-caps label above a section, e.g. "02 · HUMAN GUESSES".
export function Label({ children, tone = "line", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <p className={`text-xs font-extrabold uppercase tracking-wide ${tone === "line" ? "text-dim" : textTone[tone]} ${className}`}>
      {children}
    </p>
  );
}

// Pill badge, e.g. "HUMANS vs. AI" or "POINTS x1.5".
export function Badge({ children, tone = "line", big = false }: { children: ReactNode; tone?: Tone; big?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border font-extrabold uppercase whitespace-nowrap ${
        big ? "bg-point text-stage border-point px-5 py-2 text-2xl" : `bg-raised border-line px-3 py-2 text-xs ${textTone[tone]}`
      }`}
    >
      {children}
    </span>
  );
}

// A card on the stage. tone colors the border.
export function Panel({
  children,
  tone = "line",
  className = "",
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`bg-panel rounded-panel border-2 ${borderTone[tone]} p-[18px] ${className}`} style={style}>
      {children}
    </div>
  );
}

// The one main action on a screen.
export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`min-h-[54px] w-full rounded-inner border-2 border-action-edge bg-action px-4 py-3.5 text-base font-bold text-text transition-opacity disabled:opacity-40 ${className}`}
    />
  );
}

// Quiet secondary action: underlined text.
export function TextButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`text-sm font-bold text-muted underline underline-offset-4 ${className}`} />;
}

// Every player gets one of these colors, picked from their id so it never changes mid-game.
const AVATAR_COLORS = ["bg-ai", "bg-human", "bg-point", "bg-action", "bg-[#ffb547]", "bg-[#7ee0b5]", "bg-[#f78bf0]", "bg-[#9db4ff]"];

export function avatarColor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// What an avatar is doing right now (host describing screen).
export type AvatarState = "idle" | "prompting" | "thinking" | "locked" | "missed";

// Rounded square with the player's initial.
export function Avatar({
  id,
  name,
  size = 44,
  state = "idle",
}: {
  id: string;
  name: string;
  size?: number;
  state?: AvatarState;
}) {
  const ring =
    state === "locked" ? "ring-2 ring-point ring-offset-2 ring-offset-stage" : state === "prompting" ? "ring-2 ring-human ring-offset-2 ring-offset-stage" : "";
  return (
    <div
      className={`${avatarColor(id)} ${ring} ${state === "thinking" || state === "missed" ? "opacity-40" : ""} shrink-0 flex items-center justify-center border-2 border-stage text-stage font-display`}
      style={{ width: size, height: size, borderRadius: size * 0.34, fontSize: size / 2 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

// A thin progress bar. value goes from 0 to 1.
export function Meter({ value, tone = "point" }: { value: number; tone?: "point" | "human" | "ai" }) {
  const fill = { point: "bg-point", human: "bg-human", ai: "bg-ai" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${fill} transition-[width] duration-200 ease-linear`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

// "+235" / "−100" with the right color.
export function Delta({ value, className = "" }: { value: number; className?: string }) {
  if (value === 0) return <span className={`text-dim ${className}`}>+0</span>;
  return (
    <span className={`${value > 0 ? "text-point" : "text-ai"} tabular-nums ${className}`}>
      {value > 0 ? "+" : "−"}
      {Math.abs(value).toLocaleString()}
    </span>
  );
}
