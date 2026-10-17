import type { GameIo } from "./app.js";
import type { RoomStore } from "./rooms/RoomStore.js";

// Turns socket events (docs/data-contract.md, section 3) into calls on the right Room.
export function registerSockets(io: GameIo, rooms: RoomStore) {
  io.on("connection", (socket) => {
    // Hosts can only use host events, players only player events.
    const hostRoom = () => (socket.data.role === "host" && socket.data.code ? rooms.get(socket.data.code) : undefined);

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

    socket.on("start_game", () => {
      const error = hostRoom()?.start();
      if (error) socket.emit("error", { message: error });
    });

    socket.on("next", () => {
      hostRoom()?.next();
    });

    socket.on("disconnect", () => {
      const { role, code, playerId } = socket.data;
      if (!code) return;
      if (role === "host") rooms.close(code);
      else if (role === "player" && playerId) rooms.get(code)?.leave(playerId, socket.id);
    });
  });
}
