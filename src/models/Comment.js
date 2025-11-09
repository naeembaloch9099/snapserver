const mongoose = require("mongoose");
const { Schema } = mongoose;

const CommentSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true },
    // Store mentions as an array of User references for querying/search
    mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
    likes: { type: Number, default: 0 },
    likedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    replyTo: { type: Schema.Types.ObjectId, ref: "Comment" },
  },
  { timestamps: true }
);

// Ensure likedBy is always initialized as an array
CommentSchema.pre("save", function (next) {
  if (!Array.isArray(this.likedBy)) {
    this.likedBy = [];
  }
  next();
});

module.exports = mongoose.model("Comment", CommentSchema);
