const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    bio: { type: String },
    profilePic: { type: String },
    isPrivate: { type: Boolean, default: false },
    // follow requests awaiting owner's approval
    followRequests: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    followers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: Schema.Types.ObjectId, ref: "User" }],
    refreshTokens: [{ tokenHash: String, createdAt: Date }],
    verified: { type: Boolean, default: false },
    verifyOTP: { type: String },
    verifyOTPExpires: { type: Date },
    resetOTP: { type: String },
    resetOTPExpires: { type: Date },
    // OAuth providers
    facebookId: { type: String, index: true, sparse: true },
    providerData: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
