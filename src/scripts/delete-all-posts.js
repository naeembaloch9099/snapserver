const mongoose = require("mongoose");
const readline = require("readline");
require("dotenv").config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function deleteAllPosts() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const db = mongoose.connection.db;
    const postsCollection = db.collection("posts");

    const count = await postsCollection.countDocuments();
    console.log(`⚠️  Found ${count} posts in database`);
    console.log("⚠️  This will DELETE ALL POSTS permanently!\n");

    rl.question('Type "DELETE" to confirm: ', async (answer) => {
      if (answer === "DELETE") {
        console.log("\n🗑️  Deleting all posts...");
        const result = await postsCollection.deleteMany({});
        console.log(`✅ Deleted ${result.deletedCount} posts`);

        // Also delete all comments
        const commentsCollection = db.collection("comments");
        const commentsResult = await commentsCollection.deleteMany({});
        console.log(`✅ Deleted ${commentsResult.deletedCount} comments`);

        console.log("\n✅ Database cleaned successfully!");
        console.log(
          "💡 Going forward, use Cloudinary or S3 for media storage instead of base64"
        );
      } else {
        console.log("\n❌ Cancelled. No posts were deleted.");
      }

      await mongoose.connection.close();
      rl.close();
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

deleteAllPosts();
