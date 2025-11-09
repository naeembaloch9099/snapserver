const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const Notification = require("../models/Notification");
const { setIo } = require("./notifier");

function initSockets(io) {
  io.on("connection", (socket) => {
    // authentication can be implemented via token on query
    console.log("socket connected", socket.id);

    socket.on("join", ({ room }) => {
      if (room) socket.join(room);
    });

    socket.on("leave", ({ room }) => {
      if (room) socket.leave(room);
    });

    socket.on("markSeen", async (payload) => {
      try {
        const { conversationId, userId } = payload;
        if (!conversationId || !userId) return;

        // Mark messages as seen in database
        await Message.updateMany(
          {
            conversation: conversationId,
            sender: { $ne: userId }, // Don't mark own messages
          },
          {
            $set: { seen: true },
          }
        );

        // Broadcast to conversation room that messages are now seen
        io.to(conversationId).emit("messagesSeen", {
          conversationId,
          markedBy: userId,
        });
      } catch (e) {
        console.warn("socket markSeen error", e);
      }
    });

    socket.on("message", async (payload) => {
      try {
        const { conversationId, senderId, text } = payload;
        if (!conversationId || !senderId) return;
        const msg = await Message.create({
          conversation: conversationId,
          sender: senderId,
          text,
        });

        // Populate sender info before emitting
        const populatedMsg = await Message.findById(msg._id).populate(
          "sender",
          "username displayName avatar profilePic"
        );

        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessageAt: new Date(),
        });

        // emit populated message to room
        io.to(conversationId).emit("message", populatedMsg);

        // create notification for other participants
        const conv = await Conversation.findById(conversationId).populate(
          "participants"
        );
        if (conv) {
          conv.participants.forEach((p) => {
            if (String(p._id) !== String(senderId)) {
              Notification.create({
                user: p._id,
                type: "message",
                actor: senderId,
                meta: { conversationId },
              }).catch(console.warn);
              // optionally emit notification
              io.to(p._id.toString()).emit("notification", {
                type: "message",
                from: senderId,
                conversationId,
              });
            }
          });
        }
      } catch (e) {
        console.warn("socket message error", e);
      }
    });

    socket.on("disconnect", () => {
      console.log("socket disconnected", socket.id);
    });
  });
  // expose io to controllers via notifier
  setIo(io);
}

module.exports = { initSockets };
