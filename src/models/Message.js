const mongoose = require("mongoose");
const { Schema } = mongoose;

const MessageSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String },
    media: {
      type: String,
      enum: ["image", "video", "audio", null],
      default: null,
    },
    mediaUrl: { type: String }, // URL to the media file
    postRef: { type: Schema.Types.ObjectId, ref: "Post" }, // optional reference to a Post when a post is shared
    postSnapshot: {
      // embedded snapshot of post at share time (so preview persists even if post is deleted)
      caption: { type: String },
      image: { type: String },
      video: { type: String },
      type: { type: String, enum: ["image", "video", null] },
    }, // --- START: ADDED FIELD FOR STORY METADATA ---
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
    // --- END: ADDED FIELD FOR STORY METADATA ---
    seen: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", MessageSchema);
