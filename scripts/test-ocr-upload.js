#!/usr/bin/env node
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const fs = require("fs");

const { uploadFile } = require("../src/services/cloudinary");

const User = require("../src/models/User");
const Post = require("../src/models/Post");

async function run() {
  let fileArg = process.argv[2];
  if (!fileArg) {
    // default to a repo asset if present
    fileArg = path.join(
      __dirname,
      "..",
      "..",
      "FrontEnd",
      "src",
      "assets",
      "test-ocr-image.svg"
    );
  }
  let absolute = path.resolve(fileArg);
  if (!fs.existsSync(absolute)) {
    // if the provided file doesn't exist, create a small SVG and rasterize from it
    console.log("Input file not found, creating a small test SVG for OCR.");
    const tmpSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" fill="#ffffff"/><text x="20" y="100" font-family="Arial" font-size="48" fill="#000000">Hello OCR 2025</text></svg>`;
    const os = require("os");
    const tmpdir = os.tmpdir();
    const tmpPath = path.join(tmpdir, `test-ocr-${Date.now()}.svg`);
    fs.writeFileSync(tmpPath, tmpSvg, "utf8");
    absolute = tmpPath;
    console.log("Created temporary SVG:", absolute);
  }

  console.log("Using file:", absolute);

  const MONGO_URI =
    process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";
  await mongoose.connect(MONGO_URI);
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

  // We'll perform OCR via OCR.Space after upload by default.
  // Optionally run local tesseract.js for debugging if --tesseract flag is provided.
  let extracted = "";
  const useTesseract = process.argv.includes("--tesseract");
  if (useTesseract) {
    try {
      console.log("Attempting local tesseract OCR with logger...");
      const { createWorker } = require("tesseract.js");
      const workerOptions = {};
      try {
        workerOptions.corePath = require.resolve(
          "tesseract.js-core/tesseract-core.js"
        );
      } catch (e) {}
      try {
        workerOptions.workerPath = require.resolve(
          "tesseract.js/dist/worker.min.js"
        );
      } catch (e) {}
      const worker = createWorker({
        logger: (m) => console.log("[tesseract]", m),
        ...workerOptions,
      });
      await worker.load();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      const { data } = await worker.recognize(absolute);
      if (data && data.text) extracted = data.text.trim();
      console.log("Tesseract extracted length:", (extracted || "").length);
      await worker.terminate();
    } catch (tErr) {
      console.warn("Local tesseract attempt failed:", tErr?.message || tErr);
    }
  }

  // If input is an SVG, rasterize it to PNG first to improve OCR reliability
  let tempRasterPath = null;
  try {
    const ext = path.extname(absolute || "").toLowerCase();
    if (ext === ".svg") {
      try {
        const sharp = require("sharp");
        const tmpName = `ocr_${Date.now()}.png`;
        const os = require("os");
        tempRasterPath = path.join(os.tmpdir(), tmpName);
        await sharp(absolute).png().toFile(tempRasterPath);
        console.log("Rasterized SVG to PNG for OCR:", tempRasterPath);
        // use rasterized file for upload/ocr
        absolute = tempRasterPath;
      } catch (rErr) {
        console.warn(
          "SVG rasterization failed, continuing with original file:",
          rErr?.message || rErr
        );
      }
    }
  } catch (e) {
    console.warn("Rasterize check failed:", e?.message || e);
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
    if (tempRasterPath)
      try {
        fs.unlinkSync(tempRasterPath);
      } catch (_) {}
    process.exit(3);
  }
  // If OCR is enabled, try OCR.Space on the uploaded URL (avoids tesseract worker issues)
  try {
    const OCR_ENABLED = String(process.env.OCR_ENABLED || "false") === "true";
    if (OCR_ENABLED) {
      try {
        const fetch = require("node-fetch");
        const OCR_SPACE_KEY = process.env.OCR_SPACE_KEY || "helloworld";
        // OCR.Space: the `parse/imageurl` endpoint expects a GET with query params
        // Build the query URL instead of POSTing form data.
        const queryUrl = new URL("https://api.ocr.space/parse/imageurl");
        queryUrl.searchParams.append("apikey", OCR_SPACE_KEY);
        queryUrl.searchParams.append(
          "url",
          uploadResult.secure_url || uploadResult.url
        );
        queryUrl.searchParams.append("language", "eng");
        queryUrl.searchParams.append("isOverlayRequired", "false");
        const resp = await fetch(queryUrl.toString(), {
          method: "GET",
          headers: { "User-Agent": "SnapGram-OCR-Test" },
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "<no body>");
          throw new Error(
            `OCR.Space returned HTTP ${resp.status}: ${txt.slice(0, 400)}`
          );
        }
        const json = await resp.json();
        const OCR_DEBUG = String(process.env.OCR_DEBUG || "false") === "true";
        if (OCR_DEBUG) {
          console.log("OCR.Space response:", JSON.stringify(json, null, 2));
        }
        if (json && json.ParsedResults && json.ParsedResults[0]) {
          const parsed = json.ParsedResults[0];
          if (parsed.ParsedText && parsed.ParsedText.trim()) {
            extracted = parsed.ParsedText.trim();
            console.log("OCR.Space extracted text length:", extracted.length);
          }
        }
      } catch (spaceErr) {
        console.warn(
          "OCR.Space fallback failed (continuing):",
          spaceErr?.message || spaceErr
        );
      }
    }
  } catch (e) {
    console.warn("OCR attempt error (continuing):", e?.message || e);
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
    if (tempRasterPath)
      try {
        fs.unlinkSync(tempRasterPath);
      } catch (_) {}
    await mongoose.disconnect();
    console.log("Disconnected MongoDB");
  }
}

run().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
