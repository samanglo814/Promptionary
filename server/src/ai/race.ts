type Drawn = { data: Buffer; mimeType: string } | undefined;
type Drawer = (prompt: string) => Promise<Drawn>;

// Starts every drawer at once and uses whichever answers first, so a turn waits for the fastest
// one instead of the slowest. A drawer that fails just drops out; it only throws when all of them fail.
// The others keep running in the background and their answers are ignored.
export function firstDrawing(drawers: Drawer[]): Drawer {
  return async (prompt) => {
    try {
      return await Promise.any(drawers.map((draw) => draw(prompt)));
    } catch (err) {
      throw err instanceof AggregateError ? (err.errors[0] as Error) : err;
    }
  };
}
