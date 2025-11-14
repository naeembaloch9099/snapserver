const emitter = require("../events/eventEmitter");
let _io = null;

function setIo(io) {
  _io = io;
  console.log("✅ Socket.IO instance has been set.");

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // --- Your Original Listeners ---
    socket.on("authenticate", (userId) => {
      console.log("User authenticated, joining room:", String(userId));
      socket.join(String(userId));
      // Debug: list current rooms for this socket and the adapter state for this user room
      try {
        console.log("Socket rooms for", socket.id, Array.from(socket.rooms));
        const room = _io.sockets.adapter.rooms.get(String(userId));
        console.log(
          "Adapter room for user",
          String(userId),
          room ? Array.from(room) : null
        );
      } catch (e) {
        console.warn("Error logging adapter rooms", e);
      }
    });

    socket.on("join-room", (roomId) => {
      console.log("Socket", socket.id, "joined room", roomId);
      socket.join(roomId);
    });

    // --- NEW: All Call Signalling Listeners ---
    socket.on("call:start", (callOffer) => {
      try {
        const { recipientId } = callOffer;
        if (!recipientId) return;
        console.log(
          `📞 Relaying call from ${
            callOffer.caller.username
          } to user room: ${String(recipientId)}`
        );
        // Debug: check whether recipient room exists and which sockets are in it
        try {
          const room = _io.sockets.adapter.rooms.get(String(recipientId));
          console.log(
            "call:start - recipient room present:",
            !!room,
            room ? Array.from(room) : []
          );
        } catch (e) {
          console.warn("Error checking recipient room", e);
        }
        _io.to(String(recipientId)).emit("call:incoming", callOffer);
      } catch (e) {
        console.warn("Error relaying call:start", e);
      }
    });

    socket.on("call:accepted", (data) => {
      try {
        const { callerId } = data;
        if (!callerId) return;
        console.log(`✅ Call accepted, notifying caller: ${callerId}`);
        _io.to(String(callerId)).emit("call:accepted", data);
      } catch (e) {
        console.warn("Error relaying call:accepted", e);
      }
    });

    socket.on("call:declined", (data) => {
      try {
        const { callerId } = data;
        if (!callerId) return;
        console.log(`❌ Call declined, notifying caller: ${callerId}`);
        _io.to(String(callerId)).emit("call:declined", data);
      } catch (e) {
        console.warn("Error relaying call:declined", e);
      }
    });

    socket.on("call:end", (data) => {
      try {
        if (data.recipientId) {
          _io.to(String(data.recipientId)).emit("call:ended", data);
        }
        if (data.callerId) {
          _io.to(String(data.callerId)).emit("call:ended", data);
        }
      } catch (e) {
        console.warn("Error relaying call:end", e);
      }
    });

    // This is for advanced WebRTC signaling, but simple-peer (trickle: false)
    // bundles signals. We'll keep it for future use.
    socket.on("webrtc:signal", (payload) => {
      try {
        console.log(`Relaying WebRTC signal to: ${payload.recipientId}`);
        _io.to(payload.recipientId).emit("webrtc:signal", {
          signal: payload.signal,
          senderId: payload.senderId,
        });
      } catch (e) {
        console.warn("Error relaying WebRTC signal", e);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // --- Your Original Emitter Listeners (Unchanged) ---
  emitter.on("message", ({ roomId, message }) => {
    if (!_io) return console.warn("Socket.IO not set, can't emit message");
    try {
      console.log(`📡 [SOCKET BROADCAST] Emitting message to room: ${roomId}`);
      console.log(`📊 [SOCKET BROADCAST] Message data:`, {
        conversation: message.conversation,
        sender: message.sender,
        text: message.text?.substring(0, 50),
      });

      // Check how many sockets are in this room
      const roomSockets = _io.sockets.adapter.rooms.get(roomId);
      console.log(
        `👥 [SOCKET BROADCAST] Sockets in room ${roomId}:`,
        roomSockets ? roomSockets.size : 0
      );

      _io.to(roomId).emit("message", message);
      console.log(`✅ [SOCKET BROADCAST] Message emitted to room ${roomId}`);
    } catch (e) {
      console.warn("notifier.emitToRoom (via emitter) error", e);
    }
  });

  emitter.on("notification", ({ userId, notification }) => {
    if (!_io) return console.warn("Socket.IO not set, can't emit notification");
    try {
      _io.to(String(userId)).emit("notification", notification);
      console.log(`Socket: Emitted 'notification' to user ${userId}`);
    } catch (e) {
      console.warn("notifier.emitToUser (via emitter) error", e);
    }
  });
}

function emitToUser(userId, event, payload) {
  if (!_io)
    return console.warn("Socket.IO not set, can't emit to user", userId);
  try {
    _io.to(String(userId)).emit(event, payload);
    console.log(`Socket: Emitted '${event}' to user ${userId}`);
  } catch (e) {
    console.warn(`notifier.emitToUser error for ${userId}:`, e);
  }
}

module.exports = { setIo, emitToUser };
