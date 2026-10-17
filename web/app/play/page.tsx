import PlayerJoin from "./PlayerJoin";

// The phone view. PlayerJoin reads ?code= from the URL in the browser,
// so this page can stay fully static.
export default function PlayPage() {
  return <PlayerJoin />;
}
