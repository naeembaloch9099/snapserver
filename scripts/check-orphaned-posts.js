/**
 * Debug script to check for orphaned posts and verify post ownership
 * Run with: node scripts/check-orphaned-posts.js <username>
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Post = require("../src/models/Post");
const Comment = require("../src/models/Comment");

const username = process.argv[2];

if (!username) {
  console.error("❌ Usage: node scripts/check-orphaned-posts.js <username>");
  process.exit(1);
}

async function checkPosts() {
  try {
    await mongoose.connect(
      process.env.MONGO_URI || "mongodb://localhost:27017/snapgram"
    );
    console.log("✅ Connected to MongoDB\n");

    // Find the user
    const user = await User.findOne({ username }).lean();

    if (!user) {
      console.error(`❌ User "${username}" not found`);
      process.exit(1);
    }

    console.log("👤 User found:");
    console.log("   ID:", user._id);
    console.log("   Username:", user.username);
    console.log("   Name:", user.name);
    console.log("   Email:", user.email);
    console.log("   Created:", user.createdAt);
    console.log("");

    // Check posts by ObjectId (correct way)
    const postsByObjectId = await Post.find({ owner: user._id })
      .populate("owner", "username _id")
      .lean();

    console.log(
      `📊 Posts with owner=${user._id} (ObjectId):`,
      postsByObjectId.length
    );
    postsByObjectId.forEach((p, i) => {
      console.log(`   [${i + 1}] Post ID: ${p._id}`);
      console.log(`       Owner field: ${p.owner?._id || p.owner}`);
      console.log(
        `       Caption: ${p.caption?.substring(0, 50) || "(no caption)"}`
      );
      console.log(`       Type: ${p.type}`);
      console.log(`       Created: ${p.createdAt}`);
      console.log("");
    });

    // Check posts by username (wrong way - should find nothing if schema is correct)
    const postsByUsername = await Post.find({ owner: username }).lean();

    console.log(
      `⚠️  Posts with owner="${username}" (String):`,
      postsByUsername.length
    );
    if (postsByUsername.length > 0) {
      console.log("   ⚠️  WARNING: Found posts with string username as owner!");
      console.log(
        "   This indicates a schema mismatch - owner should be ObjectId"
      );
      postsByUsername.forEach((p, i) => {
        console.log(`   [${i + 1}] Post ID: ${p._id}, Owner: ${p.owner}`);
      });
      console.log("");
    }

    // Check ALL posts to see what owner formats exist
    const allPosts = await Post.find().limit(10).lean();
    console.log(`📋 Sample of all posts (first 10):`);
    allPosts.forEach((p, i) => {
      console.log(`   [${i + 1}] Post ${p._id}:`);
      console.log(`       Owner: ${p.owner}`);
      console.log(`       Owner type: ${typeof p.owner}`);
      console.log(
        `       Is ObjectId: ${mongoose.Types.ObjectId.isValid(p.owner)}`
      );
    });
    console.log("");

    // Check comments by this user
    const comments = await Comment.find({ user: user._id }).lean();
    console.log(`💬 Comments by user:`, comments.length);
    comments.forEach((c, i) => {
      console.log(
        `   [${i + 1}] Comment on post: ${c.post}, Text: ${c.text?.substring(
          0,
          30
        )}`
      );
    });
    console.log("");

    // Summary
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`User: ${username} (${user._id})`);
    console.log(`Posts (by ObjectId): ${postsByObjectId.length}`);
    console.log(`Posts (by username string): ${postsByUsername.length}`);
    console.log(`Comments: ${comments.length}`);

    if (postsByObjectId.length === 0 && postsByUsername.length === 0) {
      console.log("\n✅ No posts found - this is normal for a new user");
    } else if (postsByUsername.length > 0) {
      console.log(
        "\n⚠️  ACTION REQUIRED: Orphaned posts found with string owner!"
      );
      console.log("   Run migration to convert string owners to ObjectIds");
    } else {
      console.log(
        `\n✅ Found ${postsByObjectId.length} posts correctly linked`
      );
    }
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.connection.close();
    console.log("\n✅ Connection closed");
  }
}

checkPosts();
