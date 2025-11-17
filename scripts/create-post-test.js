#!/usr/bin/env node

// Usage: node scripts/create-post-test.js /path/to/file.jpg
// Connects to MongoDB, uploads file to Cloudinary, creates a Post document

require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Usage: node scripts/create-post-test.js /path/to/file.jpg");
    process.exit(2);
  }
  const filePath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(2);
  }

  const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";
  await mongoose.connect(MONGO, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB");

  const User = require("../src/models/User");
  const Post = require("../src/models/Post");
  const { uploadFile } = require("../src/services/cloudinary");

  let user = await User.findOne().lean();
  if (!user) {
    console.log("No users found in DB — creating a temporary test user");
    const tmp = new User({
      username: "test_user_" + Date.now(),
      displayName: "Test User",
      email: `test_user_${Date.now()}@example.local`,
      passwordHash: `testhash_${Date.now()}`,
    });
    await tmp.save();
    user = tmp.toObject();
  }

  try {
    console.log("Uploading file to Cloudinary:", filePath);
    const result = await uploadFile(filePath, {
      folder: "snapgram/test-posts",
    });
    console.log("Upload result secure_url:", result.secure_url);

    const payload = { owner: user._id };
    const rtype = result.resource_type || "image";
    if (rtype === "video") {
      payload.video = result.secure_url || result.url;
      payload.type = "video";
    } else {
      payload.image = result.secure_url || result.url;
      payload.type = "image";
    }

    const post = new Post(payload);
    await post.save();
    console.log("Post created:", post._id.toString());
    console.log(post);
  } catch (e) {
    console.error("Error:", e && e.message ? e.message : e);
  } finally {
    mongoose.disconnect();
  }
}

main();
