#!/usr/bin/env node
/*
  cleanup-cloudinary-orphan-posts.js

  Usage:
    - Ensure environment variables are set: MONGO_URI and CLOUDINARY_URL
    - Run: node cleanup-cloudinary-orphan-posts.js
    - To actually delete orphan posts instead of flagging them, pass --remove

  Behavior:
    - Iterates posts with a `cloudinaryId`.
    - Calls Cloudinary Admin API to check if the resource exists.
    - If missing, by default clears `image` and `cloudinaryId` and sets `mediaOrphan: true`.
      If `--remove` is passed, the script deletes the post document instead.
*/

const mongoose = require("mongoose");
const path = require("path");
const argv = process.argv.slice(2);
const doRemove = argv.includes("--remove") || argv.includes("-r");

// Load Cloudinary helper
const { cloudinary } = require(path.join(
  __dirname,
  "..",
  "src",
  "services",
  "cloudinary"
));
const Post = require(path.join(__dirname, "..", "src", "models", "Post"));

async function resourceExists(publicId) {
  try {
    // resource_type 'auto' covers both images and videos
    await cloudinary.api.resource(publicId, { resource_type: "auto" });
    return true;
  } catch (err) {
    // Cloudinary returns an error for missing resources; treat as not existing
    // Log debug details for non-404-like errors
    // err.http_code may be present on Cloudinary errors
    if (err && err.http_code === 404) return false;
    const msg = err && err.message ? err.message : String(err);
    if (/not found|Resource not found|404/i.test(msg)) return false;
    // For unexpected errors, rethrow so operator can inspect
    throw err;
  }
}

async function main() {
  const mongo =
    process.env.MONGO_URI || process.env.MONGO || process.env.MONGOURL;
  if (!mongo) {
    console.error("MONGO_URI environment variable is required");
    process.exit(2);
  }
  if (!process.env.CLOUDINARY_URL) {
    console.error(
      "CLOUDINARY_URL environment variable is required (Cloudinary config)"
    );
    process.exit(2);
  }

  await mongoose.connect(mongo, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB");

  const q = { cloudinaryId: { $exists: true, $ne: null } };
  const cursor = Post.find(q).cursor();
  let checked = 0;
  let flagged = 0;
  let removed = 0;

  try {
    for (
      let doc = await cursor.next();
      doc != null;
      doc = await cursor.next()
    ) {
      checked++;
      const publicId = doc.cloudinaryId;
      if (!publicId) continue;
      try {
        const exists = await resourceExists(publicId);
        if (!exists) {
          console.log(
            `Orphan media: post=${doc._id} publicId=${publicId} not found`
          );
          if (doRemove) {
            await Post.deleteOne({ _id: doc._id });
            removed++;
            console.log(`Deleted post ${doc._id}`);
          } else {
            // clear image/cloudinaryId and mark as orphan for manual review
            await Post.updateOne(
              { _id: doc._id },
              {
                $unset: { image: "", cloudinaryId: "" },
                $set: { mediaOrphan: true },
              }
            );
            flagged++;
            console.log(`Flagged post ${doc._id} as mediaOrphan`);
          }
        }
      } catch (inner) {
        console.error(
          `Error checking ${publicId} for post ${doc._id}:`,
          inner && inner.message ? inner.message : inner
        );
      }
    }
  } finally {
    await mongoose.disconnect();
    console.log(
      `Done. Checked=${checked} flagged=${flagged} removed=${removed}`
    );
  }
}

main().catch((e) => {
  console.error("Script failed:", e && e.message ? e.message : e);
  process.exit(1);
});
