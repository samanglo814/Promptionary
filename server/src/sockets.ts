import type { GameIo } from "./app.js";
import type { RoomStore } from "./rooms/RoomStore.js";

// Turns socket events (docs/data-contract.md, section 3) into calls on the right Room.
export function registerSockets(io: GameIo, rooms: RoomStore) {
  io.on("connection", (socket) => {
    // Hosts can only use host events, players only player events.
    const hostRoom = () => (socket.data.role === "host" && socket.data.code ? rooms.get(socket.data.code) : undefined);

    // A dropped connection that came back in time (Socket.io connection state recovery): same socket id,
    // same socket.data, and Socket.io replays the events it missed. Just mark it connected again.
    if (socket.recovered) {
      const { role, code, playerId } = socket.data;
      if (role === "host" && code && rooms.get(code)) rooms.hostBack(code);
      else if (role === "host") {
        // Came back just as its room closed: give the page a new one (it goes back to the lobby).
        socket.data = {};
        const room = rooms.create(socket);
        socket.emit("room_created", { code: room.code });
      }
      if (role === "player" && code && playerId && !rooms.get(code)?.resume(socket, playerId)) {
        socket.data = {};
        socket.emit("error", { message: "You were disconnected for too long. Join again!" });
      }
    }

    socket.on("create_room", () => {
      if (socket.data.role) return; // one room per host page
      const room = rooms.create(socket);
      socket.emit("room_created", { code: room.code });
    });

    socket.on("join", (payload) => {
      if (socket.data.role) return; // already in a room
      // Payloads come from the network, so check them before trusting them.
      const code = typeof payload?.code === "string" ? payload.code : "";
      const name = typeof payload?.name === "string" ? payload.name : "";
      const playerId = typeof payload?.playerId === "string" ? payload.playerId : undefined;

      const room = rooms.get(code);
      if (!room) return socket.emit("join_error", { reason: "room_not_found" });
      const error = room.join(socket, name, playerId);
      if (error) socket.emit("join_error", { reason: error });
    });

    socket.on("guess", (payload) => {
      const { role, code, playerId } = socket.data;
      const room = role === "player" && code ? rooms.get(code) : undefined;
      if (!room || !playerId) return socket.emit("guess_error", { reason: "not_now" });
      const text = typeof payload?.text === "string" ? payload.text : "";
      const error = room.guess(playerId, text);
      if (error) socket.emit("guess_error", { reason: error });
    });

    socket.on("speaking", () => {
      const { role, code, playerId } = socket.data;
      if (role === "player" && code && playerId) rooms.get(code)?.speaking(playerId);
    });

    // The host page waits for the answer, so a click that never reached the server doesn't fail silently.
    socket.on("start_game", (ack) => {
      const room = hostRoom();
      const error = room ? room.start() : "This room is gone. Refresh the page to make a new one.";
      if (error) socket.emit("error", { message: error });
      if (typeof ack === "function") ack({ error });
    });

    socket.on("next", () => {
      hostRoom()?.next();
    });

    // "client namespace disconnect" means the page closed the connection on purpose. Anything else
    // (a locked phone, a tunnel blip) may come back, so the host gets a grace period.
    socket.on("disconnect", (reason) => {
      const { role, code, playerId } = socket.data;
      if (!code) return;
      const onPurpose = reason === "client namespace disconnect";
      if (role === "host") {
        if (onPurpose) rooms.close(code);
        else rooms.hostLeft(code);
      } else if (role === "player" && playerId) {
        rooms.get(code)?.leave(playerId, socket.id, onPurpose);
      }
    });
  });
}
