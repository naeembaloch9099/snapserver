/**
 * Script to remove self-follows from the database
 * This fixes users who accidentally followed themselves
 */

const mongoose = require("mongoose");
const User = require("../src/models/User");

async function removeSelfFollows() {
  try {
    console.log("🔍 Connecting to database...");
    await mongoose.connect(
      process.env.MONGO_URI || "mongodb://localhost:27017/snapgram"
    );
    console.log("✅ Connected to database");

    console.log("\n🔍 Finding users with self-follows...");
    const users = await User.find({});

    let fixedCount = 0;

    for (const user of users) {
      let needsUpdate = false;
      const userId = String(user._id);

      // Check if user is in their own followers array
      if (Array.isArray(user.followers)) {
        const hasSelf = user.followers.some((f) => String(f) === userId);
        if (hasSelf) {
          console.log(`❌ ${user.username} is in their own followers array`);
          user.followers = user.followers.filter((f) => String(f) !== userId);
          needsUpdate = true;
        }
      }

      // Check if user is in their own following array
      if (Array.isArray(user.following)) {
        const hasSelf = user.following.some((f) => String(f) === userId);
        if (hasSelf) {
          console.log(`❌ ${user.username} is in their own following array`);
          user.following = user.following.filter((f) => String(f) !== userId);
          needsUpdate = true;
        }
      }

      // Check if user has a follow request from themselves
      if (Array.isArray(user.followRequests)) {
        const hasSelf = user.followRequests.some((r) => {
          const requesterId = r.user ? String(r.user) : String(r);
          return requesterId === userId;
        });
        if (hasSelf) {
          console.log(
            `❌ ${user.username} has a follow request from themselves`
          );
          user.followRequests = user.followRequests.filter((r) => {
            const requesterId = r.user ? String(r.user) : String(r);
            return requesterId !== userId;
          });
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await user.save();
        fixedCount++;
        console.log(`✅ Fixed ${user.username}`);
      }
    }

    console.log(`\n✅ Done! Fixed ${fixedCount} users`);
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await mongoose.connection.close();
    console.log("👋 Database connection closed");
  }
}

// Run the script
removeSelfFollows();
