#!/usr/bin/env node
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const FormData = require("form-data");
const fetch = require("node-fetch");
const jwt = require("jsonwebtoken");

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
  const absolute = path.resolve(fileArg);
  // If file not found, create a small SVG and rasterize to PNG so tests can run
  let finalPath = absolute;
  if (!fs.existsSync(finalPath)) {
    console.log(
      "Input file not found, creating a small test SVG for API post."
    );
    const tmpSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" fill="#ffffff"/><text x="20" y="100" font-family="Arial" font-size="48" fill="#000000">Hello OCR 2025</text></svg>`;
    const os = require("os");
    const tmpdir = os.tmpdir();
    const tmpSvgPath = path.join(tmpdir, `test-api-ocr-${Date.now()}.svg`);
    fs.writeFileSync(tmpSvgPath, tmpSvg, "utf8");
    // rasterize using sharp if available
    try {
      const sharp = require("sharp");
      const pngPath = path.join(tmpdir, `test-api-ocr-${Date.now()}.png`);
      await sharp(tmpSvgPath).png().toFile(pngPath);
      finalPath = pngPath;
      console.log("Rasterized SVG to PNG for API post:", finalPath);
    } catch (rErr) {
      console.warn(
        "SVG rasterization failed, using SVG file for upload:",
        rErr?.message || rErr
      );
      finalPath = tmpSvgPath;
    }
  }

  const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";
  await mongoose.connect(MONGO);

  const User = require("../src/models/User");

  // find the ocr_test_user
  const user = await User.findOne({ username: "ocr_test_user" });
  if (!user) {
    console.error(
      "Test user `ocr_test_user` not found. Run the test-ocr-upload script first."
    );
    process.exit(2);
  }

  // sign an access token for user
  const secret = process.env.JWT_ACCESS_SECRET || "access-secret";
  const access = jwt.sign(
    { sub: String(user._id), username: user.username },
    secret,
    { expiresIn: "15m" }
  );

  const serverUrl = process.env.SERVER_URL || "http://localhost:4000";
  const url = `${serverUrl}/api/posts`;

  const form = new FormData();
  form.append("caption", "API test post from script");
  form.append("file", fs.createReadStream(finalPath));

  console.log("Posting to", url, "as", user.username);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
    },
    body: form,
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
