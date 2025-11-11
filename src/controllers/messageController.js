const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
// --- FIX: Import the emitter, not the notifier ---
const emitter = require("../events/eventEmitter");
const Post = require("../models/Post");

const getOrCreateConversation = async (req, res) => {
  try {
    const { participantId } = req.body;
    if (!participantId)
      return res.status(400).json({ error: "participantId required" });
    // find existing conversation with both participants
    let conv = await Conversation.findOne({
      participants: { $all: [req.user._id, participantId] },
    });
    if (!conv) {
      conv = new Conversation({ participants: [req.user._id, participantId] });
      await conv.save();
    }
    res.json(conv);
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const listConversations = async (req, res) => {
  try {
    const convs = await Conversation.find({ participants: req.user._id })
      .sort({ lastMessageAt: -1 })
      .populate("participants", "username displayName avatar profilePic")
      .lean();

    // Populate messages for each conversation and add unread count
    const withMessages = await Promise.all(
      convs.map(async (conv) => {
        const messages = await Message.find({ conversation: conv._id })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate("sender", "username displayName avatar profilePic")
          .lean();

        const unreadCount = conv.unreadCounts?.[req.user._id.toString()] || 0;

        return {
          ...conv,
          messages: messages.reverse(),
          unread: unreadCount,
        };
      })
    );

    res.json(withMessages);
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 0, limit = 50 } = req.query;
    const skip = Math.max(0, parseInt(page)) * parseInt(limit);
    const messages = await Message.find({ conversation: conversationId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("sender", "username displayName avatar profilePic")
      .lean();
    res.json(messages.reverse());
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const markSeen = async (req, res) => {
  try {
    const { conversationId } = req.params;
    // Mark all messages in this conversation as seen (for current user)
    const result = await Message.updateMany(
      {
        conversation: conversationId,
        sender: { $ne: req.user._id }, // Don't mark own messages as seen
      },
      {
        $set: { seen: true },
      }
    );

    // Reset unread count for current user
    await Conversation.findByIdAndUpdate(conversationId, {
      $set: {
        [`unreadCounts.${req.user._id.toString()}`]: 0,
      },
    });

    res.json({ ok: true, modifiedCount: result.modifiedCount });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    // Renamed 'media' to 'mediaTypeFromClient' for clarity
    const {
      text,
      media: mediaTypeFromClient,
      mediaUrl: bodyMediaUrl,
      fileName,
      postId,
    } = req.body;
    const uploadedFile = req.file; // The file from multer

    console.log("📨 SEND MESSAGE REQUEST:", {
      conversationId,
      text,
      media: mediaTypeFromClient, // This is the string "image", "video", etc.
      fileName,
      postId,
      file: uploadedFile ? uploadedFile.filename : undefined,
      userId: req.user._id,
    });

    if (!conversationId) {
      console.error("❌ Missing conversationId");
      return res.status(400).json({ error: "Missing conversationId" });
    }

    // ---
    // **FIX 1: CORRECTED VALIDATION**
    // Check for actual content: text, an uploaded file, or a manually provided URL
    // ---
    if (!text && !uploadedFile && !bodyMediaUrl && !postId) {
      console.error("❌ Missing text, file, and mediaUrl");
      return res
        .status(400)
        .json({ error: "Message must contain text or media." });
    }

    console.log("✅ Creating message in DB...");

    let resolvedMediaUrl = null;
    let resolvedMediaType = null;
    let referencedPost = null;

    // If a postId was provided and no explicit file/url is supplied, resolve media from the post
    if (postId && !uploadedFile && !bodyMediaUrl) {
      try {
        referencedPost = await Post.findById(postId).lean();
        if (referencedPost) {
          resolvedMediaUrl =
            referencedPost.image || referencedPost.video || null;
          resolvedMediaType =
            referencedPost.type ||
            (referencedPost.image
              ? "image"
              : referencedPost.video
              ? "video"
              : null);
        }
      } catch (e) {
        console.warn(
          "Failed to resolve post for postId",
          postId,
          e && e.message ? e.message : e
        );
      }
    }

    if (uploadedFile) {
      // Build absolute URL
      const host = `${req.protocol}://${req.get("host")}`;
      resolvedMediaUrl = `${host}/uploads/${uploadedFile.filename}`;

      // ---
      // **FIX 2: INFER MEDIA TYPE FROM FILE**
      // This is more robust than trusting the client's 'media' field
      // ---
      if (uploadedFile.mimetype.startsWith("image")) {
        resolvedMediaType = "image";
      } else if (uploadedFile.mimetype.startsWith("video")) {
        resolvedMediaType = "video";
      } else if (uploadedFile.mimetype.startsWith("audio")) {
        resolvedMediaType = "audio";
      }
    } else if (bodyMediaUrl) {
      resolvedMediaUrl = bodyMediaUrl;
      // If it's just a URL, we have to trust the client's media type
      resolvedMediaType = mediaTypeFromClient || null;
    }

    // Ensure the type is valid for the schema enum
    const validMediaTypes = ["image", "video", "audio", null];
    if (!validMediaTypes.includes(resolvedMediaType)) {
      console.warn(
        `⚠️ Invalid media type: ${resolvedMediaType}. Forcing to null.`
      );
      resolvedMediaType = null;
    }

    const msg = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      // Set default text for media-only messages
      text:
        text ||
        (resolvedMediaType
          ? `[${String(resolvedMediaType).toUpperCase()}]`
          : ""),
      media: resolvedMediaType, // Use the new, more reliable type
      mediaUrl: resolvedMediaUrl, // Use the new URL
      postRef: postId || undefined,
    });

    console.log("✅ Message created:", msg._id);

    const populatedMsg = await Message.findById(msg._id)
      .populate("sender", "username displayName avatar profilePic")
      .populate("postRef", "caption image video type owner");

    console.log("✅ Message populated, sending to others...");

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessageAt: new Date(),
    });

    // notify other participants
    const conv = await Conversation.findById(conversationId).populate(
      "participants"
    );

    if (conv) {
      console.log("📢 Notifying participants...");
      conv.participants.forEach((p) => {
        if (String(p._id) !== String(req.user._id)) {
          // Increment unread count for this participant
          Conversation.findByIdAndUpdate(conversationId, {
            $inc: {
              [`unreadCounts.${p._id.toString()}`]: 1,
            },
          }).catch(console.warn);

          Notification.create({
            user: p._id,
            type: "message",
            actor: req.user._id,
            meta: { conversationId },
          }).catch(console.warn);

          console.log("📲 Emitting notification to user:", p._id.toString());

          // ---
          // **FIX 3: EMIT EVENT INSTEAD OF CALLING SOCKET FUNCTION**
          // ---
          try {
            const actorProfile = {
              _id: req.user._id,
              username: req.user.username,
              displayName: req.user.displayName,
              avatar: req.user.profilePic || req.user.avatar,
            };

            emitter.emit("notification", {
              userId: p._id.toString(),
              notification: {
                type: "message",
                from: req.user._id,
                actor: actorProfile,
                conversationId,
              },
            });
          } catch (e) {
            console.warn("emit notification failed", e);
          }
        }
      });
    }

    // ---
    // **FIX 3: EMIT EVENT FOR THE NEW MESSAGE**
    // ---
    try {
      console.log("📡 Broadcasting message event for room:", conversationId);
      emitter.emit("message", {
        roomId: conversationId,
        message: populatedMsg.toObject ? populatedMsg.toObject() : populatedMsg,
      });
      console.log("✅ Message event broadcast successful");
    } catch (e) {
      console.error("❌ Emit message event failed:", e);
    }

    console.log("✅ SENDING RESPONSE:", {
      _id: populatedMsg._id,
      text: populatedMsg.text,
      media: populatedMsg.media,
    });

    res.json(populatedMsg);
  } catch (e) {
    console.error("❌ SEND MESSAGE ERROR:", e);
    res.status(500).json({ error: "Server error", details: e.message });
  }
};

module.exports = {
  getOrCreateConversation,
  getMessages,
  markSeen,
  listConversations,
  sendMessage,
};
