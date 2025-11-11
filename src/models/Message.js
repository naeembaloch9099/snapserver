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
    seen: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", MessageSchema);
