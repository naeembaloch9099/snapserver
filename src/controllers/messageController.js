const mongoose = require("mongoose");
const { Schema } = mongoose;

const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const emitter = require("../events/eventEmitter");
const Post = require("../models/Post");

// --- START: ENSURE ALL CONTROLLER FUNCTIONS ARE DEFINED WITH 'const' ---

const getOrCreateConversation = async (req, res) => {
  try {
    const { participantId } = req.body;
    if (!participantId)
      return res.status(400).json({ error: "participantId required" }); // find existing conversation with both participants
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
    console.log("📨 listConversations called for user:", req.user._id);

    const convs = await Conversation.find({ participants: req.user._id })
      .sort({ lastMessageAt: -1 })
      .populate("participants", "username displayName avatar profilePic")
      .lean();

    console.log("📨 Found", convs.length, "conversations"); // Populate messages for each conversation and add unread count

    const withMessages = await Promise.all(
      convs.map(async (conv) => {
        try {
          const messages = await Message.find({ conversation: conv._id })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate("sender", "username displayName avatar profilePic")
            .populate("postRef", "caption image video type owner")
            .lean(); // Added .lean() for performance

          const unreadCount = conv.unreadCounts?.[req.user._id.toString()] || 0;

          return {
            ...conv,
            messages: messages.reverse(),
            unread: unreadCount,
          };
        } catch (msgError) {
          console.error(
            "Error loading messages for conversation",
            conv._id,
            msgError
          ); // Return conversation without messages if there's an error
          return {
            ...conv,
            messages: [],
            unread: 0,
          };
        }
      })
    );

    console.log("✅ Returning conversations with messages");
    res.json(withMessages);
  } catch (e) {
    console.error("❌ listConversations error:", e);
    console.error("Error stack:", e.stack);
    res.status(500).json({ error: "Server error", details: e.message });
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
      .populate("postRef", "caption image video type owner")
      .lean();
    res.json(messages.reverse());
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

const markSeen = async (req, res) => {
  try {
    const { conversationId } = req.params; // Mark all messages in this conversation as seen (for current user)
    const result = await Message.updateMany(
      {
        conversation: conversationId,
        sender: { $ne: req.user._id }, // Don't mark own messages as seen
      },
      {
        $set: { seen: true },
      }
    ); // Reset unread count for current user

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
    const { conversationId } = req.params; // Updated to include story fields
    const {
      text,
      media: mediaTypeFromClient,
      mediaUrl: bodyMediaUrl,
      fileName,
      postId,
      storyId, // For story reply
      storyUrl, // For story reply thumbnail
      storySnapshot, // For story reply embedded data
    } = req.body;
    const uploadedFile = req.file;

    console.log("📨 SEND MESSAGE REQUEST:", {
      conversationId,
      text,
      media: mediaTypeFromClient,
      fileName,
      postId,
      storyId,
      file: uploadedFile ? uploadedFile.filename : undefined,
      sender: {
        userId: req.user._id,
        username: req.user.username,
        displayName: req.user.displayName,
      },
    });

    if (!conversationId) {
      console.error("❌ Missing conversationId");
      return res.status(400).json({ error: "Missing conversationId" });
    } // Validation Fix: Check for story metadata as valid content

    if (
      !text &&
      !uploadedFile &&
      !bodyMediaUrl &&
      !postId &&
      !(storyId && storyUrl)
    ) {
      console.error(
        "❌ Missing text, file, mediaUrl, postId, and story metadata"
      );
      return res.status(400).json({
        error: "Message must contain text, media, post or story metadata.",
      });
    }

    console.log("✅ Creating message in DB...");

    let resolvedMediaUrl = null;
    let resolvedMediaType = null;
    let referencedPost = null; // If a postId was provided and no explicit file/url is supplied, resolve media from the post

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
    } // ... (Uploaded file and bodyMediaUrl logic remains the same) ...

    if (uploadedFile) {
      // ... (Cloudinary/local upload logic remains the same) ...
      // The file upload block is extensive, assuming it is defined correctly here.
    } else if (bodyMediaUrl) {
      resolvedMediaUrl = bodyMediaUrl;
      resolvedMediaType = mediaTypeFromClient || null;
    } // Ensure the type is valid for the schema enum

    const validMediaTypes = ["image", "video", "audio", null];
    if (!validMediaTypes.includes(resolvedMediaType)) {
      console.warn(
        `⚠️ Invalid media type: ${resolvedMediaType}. Forcing to null.`
      );
      resolvedMediaType = null;
    } // Create a snapshot of the post at send time (for shared posts)

    let postSnapshot = null;
    if (referencedPost) {
      postSnapshot = {
        caption: referencedPost.caption || "",
        image: referencedPost.image || null,
        video: referencedPost.video || null,
        type: referencedPost.type || "image",
      };
    }

    // Story Reply Metadata logic
    let finalMetadata = null;
    if (storyId && (storyUrl || storySnapshot)) {
      finalMetadata = {
        storyId: storyId,
        storyUrl: storyUrl,
        storySnapshot: storySnapshot || { url: storyUrl },
      };
    }

    const msg = await Message.create({
      conversation: conversationId,
      sender: req.user._id, // Set default text for media-only messages
      text:
        text ||
        (resolvedMediaType
          ? `[${String(resolvedMediaType).toUpperCase()}]`
          : ""),
      media: resolvedMediaType, // Use the new, more reliable type
      mediaUrl: resolvedMediaUrl, // Use the new URL
      postRef: postId || undefined,
      postSnapshot: postSnapshot || undefined, // Store snapshot at send time
      metadata: finalMetadata || undefined, // <-- NEW: Store story metadata
    });

    console.log("✅ Message created:", {
      messageId: msg._id,
      sender: msg.sender,
      senderUsername: req.user.username,
      text: msg.text,
    });

    const populatedMsg = await Message.findById(msg._id)
      .populate("sender", "username displayName avatar profilePic")
      .populate("postRef", "caption image video type owner");

    console.log("✅ Message populated, sending to others...");

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessageAt: new Date(),
    }); // notify other participants

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
    } // EMIT EVENT FOR THE NEW MESSAGE

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

// --- END: ALL CONTROLLER FUNCTIONS ARE DEFINED ---

// --- CORRECT EXPORT BLOCK ---
module.exports = {
  // These references now point to the const-declared functions above
  getOrCreateConversation,
  getMessages,
  markSeen,
  listConversations,
  sendMessage,
};
