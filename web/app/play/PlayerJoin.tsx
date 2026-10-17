// "use client" makes this run in the browser.
// Needed because we use state and form input.
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Player } from "@/lib/mocks";

// Read ?code= in the browser (window doesn't exist on the server, so it's "" there).
const codeFromUrl = () =>
  (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase().slice(0, 4);
const noSubscribe = () => () => {};

export default function PlayerJoin() {
  // Room code comes from the QR link, but players can also type it in.
  const urlCode = useSyncExternalStore(noSubscribe, codeFromUrl, () => "");
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const code = typedCode ?? urlCode;

  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  // Came from the QR code? Jump straight to the name field.
  useEffect(() => {
    if (urlCode) nameRef.current?.focus();
  }, [urlCode]);

  // Once joined, we have a player and show the waiting screen.
  const [me, setMe] = useState<Player | null>(null);

  const canJoin = code.trim().length === 4 && name.trim().length > 0;

  function join(e: React.FormEvent) {
    e.preventDefault();
    if (!canJoin) return;

    // FAKE: pretend the server accepted us.
    // Replace with socket.emit("join", { code, name }) once the server exists.
    setMe({ id: crypto.randomUUID(), name: name.trim(), score: 0 });
  }

  // Waiting screen
  if (me) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
        <p className="text-lg uppercase tracking-widest opacity-60">Room {code}</p>
        <div className="bg-zap rounded-card px-8 py-5 text-4xl font-black animate-[pop_0.3s_ease-out]">
          {me.name}
        </div>
        <h1 className="text-3xl font-black">You&apos;re in!</h1>
        <p className="text-lg opacity-60 animate-pulse">Waiting for the host to start…</p>
      </main>
    );
  }

  // Join form
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-4xl font-black tracking-tight text-center">Reverse Charades</h1>

      <form
        onSubmit={join}
        className="bg-white rounded-card shadow-lg p-6 w-full max-w-sm flex flex-col gap-5"
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-widest opacity-60">Room code</span>
          <input
            value={code}
            onChange={(e) => setTypedCode(e.target.value.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABCD"
            className="text-4xl font-black text-pop tracking-widest text-center border-2 border-ink/10 rounded-card py-3 outline-none focus:border-pop"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-widest opacity-60">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            autoComplete="off"
            ref={nameRef}
            placeholder="Sam"
            className="text-2xl font-bold text-center border-2 border-ink/10 rounded-card py-3 outline-none focus:border-pop"
          />
        </label>

        <button
          type="submit"
          disabled={!canJoin}
          className="bg-pop text-white text-2xl font-bold py-4 rounded-card disabled:opacity-40"
        >
          Join
        </button>
      </form>
    </main>
  );
}
