const mongoose = require("mongoose");
const { Schema } = mongoose;

const PendingUserSchema = new Schema(
  {
    username: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    // optional preview/profile fields collected during signup
    profilePic: { type: String },
    bio: { type: String },
    verifyOTP: { type: String },
    verifyOTPExpires: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PendingUser", PendingUserSchema);
