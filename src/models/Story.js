const mongoose = require("mongoose");
const { Schema } = mongoose;

const StorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    cloudinaryId: { type: String },
    url: { type: String },
    isPrivate: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

// TTL index to remove story documents once expiresAt is reached
StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Story", StorySchema);
