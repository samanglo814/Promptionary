import type { GameSocket } from "../app.js";
import { Room, type RoomDeps } from "./Room.js";

// No I or O, so codes can't be confused with 1 and 0.
const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

// Every live room, in memory. Rooms vanish when the host disconnects or the server restarts.
export class RoomStore {
  private rooms = new Map<string, Room>();
  // Rooms whose host's connection dropped: closed unless the host reconnects in time.
  private closing = new Map<string, NodeJS.Timeout>();

  constructor(private deps: RoomDeps) {}

  create(host: GameSocket): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code, this.deps);
    this.rooms.set(code, room);
    host.data = { role: "host", code };
    void host.join(code);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  close(code: string) {
    this.hostBack(code);
    this.rooms.get(code)?.close();
    this.rooms.delete(code);
  }

  hostLeft(code: string) {
    if (this.closing.has(code)) return;
    this.closing.set(code, setTimeout(() => this.close(code), this.deps.config.hostGraceMs));
  }

  hostBack(code: string) {
    clearTimeout(this.closing.get(code));
    this.closing.delete(code);
  }
}
