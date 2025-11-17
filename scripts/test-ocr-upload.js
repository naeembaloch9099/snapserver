#!/usr/bin/env node
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const fs = require("fs");

const { uploadFile } = require("../src/services/cloudinary");

const User = require("../src/models/User");
const Post = require("../src/models/Post");

async function run() {
  const fileArg =
    process.argv[2] ||
    path.join(__dirname, "..", "..", "FrontEnd", "src", "assets", "react.svg");
  const absolute = path.resolve(fileArg);
  if (!fs.existsSync(absolute)) {
    console.error("File not found:", absolute);
    process.exit(2);
  }

  console.log("Using file:", absolute);

  const MONGO_URI =
    process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB");

  // Ensure test user exists (create if missing)
  let user = await User.findOne({ username: "ocr_test_user" });
  if (!user) {
    console.log("Creating test user `ocr_test_user`");
    user = await User.create({
      username: "ocr_test_user",
      email: `ocr_test_user_${Date.now()}@example.com`,
      passwordHash: "test",
      name: "OCR Test",
      profilePic: "",
      bio: "Created by test script",
      verified: true,
      followers: [],
      following: [],
      followRequests: [],
      refreshTokens: [],
    });
  } else {
    console.log("Found existing test user:", user._id);
  }

  // Run OCR using tesseract.js
  let extracted = "";
  try {
    const { createWorker } = require("tesseract.js");
    // Use local core and worker files so the Node worker doesn't attempt
    // to `fetch` the wasm/core over the network which can fail in some
    // environments. These files are provided by the installed packages.
    const corePath = require.resolve("tesseract.js-core/tesseract-core.js");
    const workerPath = require.resolve("tesseract.js/dist/worker.min.js");
    const worker = createWorker({ corePath, workerPath });
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const { data } = await worker.recognize(absolute);
    extracted = data && data.text ? data.text.trim() : "";
    console.log("OCR extracted text length:", extracted.length);
    await worker.terminate();
  } catch (ocrErr) {
    console.warn("OCR error (continuing):", ocrErr.message || ocrErr);
  }

  // Upload to Cloudinary
  let uploadResult;
  try {
    uploadResult = await uploadFile(absolute, { folder: "snapgram/test" });
    console.log(
      "Cloudinary upload result:",
      uploadResult.secure_url || uploadResult.url
    );
  } catch (e) {
    console.error("Cloudinary upload failed:", e.message || e);
    process.exit(3);
  }

  // Create post in DB
  try {
    const payload = {
      owner: user._id,
      caption: "OCR test post",
      extractedText: extracted || undefined,
    };
    if (uploadResult.resource_type === "video") {
      payload.video = uploadResult.secure_url || uploadResult.url;
      payload.type = "video";
    } else {
      payload.image = uploadResult.secure_url || uploadResult.url;
      payload.type = "image";
    }
    const post = await Post.create(payload);
    console.log("Post created with id:", post._id);
    console.log(
      "Post.extractedText (first 300 chars):",
      (post.extractedText || "").slice(0, 300)
    );
  } catch (dbErr) {
    console.error("Failed to create post in DB:", dbErr.message || dbErr);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected MongoDB");
  }
}

run().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
