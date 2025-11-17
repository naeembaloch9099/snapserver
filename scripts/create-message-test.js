#!/usr/bin/env node

// Usage: node scripts/create-message-test.js /path/to/file.jpg
// Uploads file to Cloudinary and creates a Message in DB for a conversation between two users

require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error(
      "Usage: node scripts/create-message-test.js /path/to/file.jpg"
    );
    process.exit(2);
  }
  const filePath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(2);
  }

  const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";
  await mongoose.connect(MONGO);
  console.log("Connected to MongoDB");

  const User = require("../src/models/User");
  const Message = require("../src/models/Message");
  const Conversation = require("../src/models/Conversation");
  const { uploadFile } = require("../src/services/cloudinary");

  // find or create two users
  let users = await User.find().limit(2).lean();
  if (!users || users.length < 2) {
    console.log("Less than 2 users found — creating test users");
    const u1 = new User({
      username: "msg_user1_" + Date.now(),
      email: `u1_${Date.now()}@example.local`,
      passwordHash: "hash1",
    });
    const u2 = new User({
      username: "msg_user2_" + Date.now(),
      email: `u2_${Date.now()}@example.local`,
      passwordHash: "hash2",
    });
    await u1.save();
    await u2.save();
    users = [u1.toObject(), u2.toObject()];
  }

  const sender = users[0];
  const recipient = users[1];

  // find or create conversation between them
  let conv = await Conversation.findOne({
    participants: { $all: [sender._id, recipient._id] },
  });
  if (!conv) {
    conv = new Conversation({ participants: [sender._id, recipient._id] });
    await conv.save();
  }

  try {
    console.log("Uploading file to Cloudinary:", filePath);
    const result = await uploadFile(filePath, {
      folder: "snapgram/messages-test",
    });
    console.log("Upload result secure_url:", result.secure_url);

    const resolvedMediaUrl = result.secure_url || result.url;
    const rtype = result.resource_type || "image";
    const resolvedMediaType = rtype === "video" ? "video" : "image";

    const msg = new Message({
      conversation: conv._id,
      sender: sender._id,
      text: `[${resolvedMediaType.toUpperCase()}]`,
      media: resolvedMediaType,
      mediaUrl: resolvedMediaUrl,
    });
    await msg.save();
    console.log("Message created:", msg._id.toString());
    console.log(msg);
  } catch (e) {
    console.error("Error:", e && e.message ? e.message : e);
  } finally {
    mongoose.disconnect();
  }
}

main();
