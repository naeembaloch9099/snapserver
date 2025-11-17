#!/usr/bin/env node
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");

async function main() {
  const fileArg =
    process.argv[2] ||
    path.join(
      __dirname,
      "..",
      "..",
      "FrontEnd",
      "src",
      "assets",
      "test-ocr-image.png"
    );
  let absolute = path.resolve(fileArg);
  if (!fs.existsSync(absolute)) {
    console.log(
      "Input file not found, creating a small test SVG for client-like flow."
    );
    const tmpSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" fill="#ffffff"/><text x="20" y="100" font-family="Arial" font-size="48" fill="#000000">Hello OCR 2025</text></svg>`;
    const os = require("os");
    const tmpdir = os.tmpdir();
    const tmpSvgPath = path.join(tmpdir, `test-client-ocr-${Date.now()}.svg`);
    fs.writeFileSync(tmpSvgPath, tmpSvg, "utf8");
    try {
      const sharp = require("sharp");
      const pngPath = path.join(tmpdir, `test-client-ocr-${Date.now()}.png`);
      await sharp(tmpSvgPath).png().toFile(pngPath);
      absolute = pngPath;
      console.log("Rasterized SVG to PNG for client test:", absolute);
    } catch (rErr) {
      console.warn(
        "SVG rasterize failed, using SVG file:",
        rErr?.message || rErr
      );
      absolute = tmpSvgPath;
    }
  }

  // connect to DB to find test user
  const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";
  await mongoose.connect(MONGO);
  const User = require("../src/models/User");
  const user = await User.findOne({ username: "ocr_test_user" });
  if (!user) {
    console.error(
      "Test user `ocr_test_user` not found. Run test-ocr-upload first."
    );
    process.exit(2);
  }

  // Upload file to Cloudinary using existing helper
  const { uploadFile } = require("../src/services/cloudinary");
  let uploadResult;
  try {
    uploadResult = await uploadFile(absolute, {
      folder: "snapgram/test-client",
    });
    console.log(
      "Uploaded to Cloudinary:",
      uploadResult.secure_url || uploadResult.url
    );
  } catch (e) {
    console.error("Cloudinary client-like upload failed:", e.message || e);
    process.exit(3);
  }

  const secret = process.env.JWT_ACCESS_SECRET || "access-secret";
  const token = jwt.sign(
    { sub: String(user._id), username: user.username },
    secret,
    { expiresIn: "15m" }
  );

  const serverUrl = process.env.SERVER_URL || "http://localhost:4000";
  const apiUrl = `${serverUrl}/api/posts`;

  const payload = {
    caption: "Client-like upload test",
    type: uploadResult.resource_type === "video" ? "video" : "image",
    media: uploadResult.secure_url || uploadResult.url,
    image: uploadResult.secure_url || uploadResult.url,
  };

  console.log("Posting to server as JSON with image URL...");
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  console.log("Status:", resp.status);
  console.log("Response:", text);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
