const mongoose = require("mongoose");
const { Schema } = mongoose;

const PostSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    caption: { type: String },
    // extractedText: optional OCR-extracted text from the image for search/access
    extractedText: { type: String },
    image: { type: String },
    video: { type: String },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    reposts: { type: Number, default: 0 },
    repostedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    comments: [{ type: Schema.Types.ObjectId, ref: "Comment" }],
    shareCount: { type: Number, default: 0 },
    type: { type: String, enum: ["image", "video"], default: "image" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", PostSchema);
