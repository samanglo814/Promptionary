"use client";

import { useEffect, useState } from "react";

// Whole seconds until `endsAt` (epoch ms, sent by the server), updated a few times a second.
// null when there's no deadline.
export function useSecondsLeft(endsAt?: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}
