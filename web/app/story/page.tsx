import type { Metadata } from "next";
import StoryReader from "./StoryReader";

export const metadata: Metadata = {
  title: "Promptionary storybook",
  description: "A night of Promptionary, told as a picture book: what everyone described, and what the AI drew.",
};

// The shareable storybook (the QR code at the end of a game). StoryReader reads ?id= from the URL
// in the browser and fetches the book from the game server, so this page can stay fully static.
export default function StoryPage() {
  return <StoryReader />;
}
