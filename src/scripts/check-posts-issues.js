const mongoose = require("mongoose");
require("dotenv").config();

async function checkPosts() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const db = mongoose.connection.db;
    const postsCollection = db.collection("posts");

    console.log("=== CHECKING POSTS ===\n");

    // Try to fetch posts with a timeout
    console.log("Attempting to fetch posts with sort...");
    const startTime = Date.now();

    try {
      const posts = await postsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .maxTimeMS(10000) // 10 second timeout
        .toArray();

      const endTime = Date.now();
      console.log(`✅ Query completed in ${endTime - startTime}ms`);
      console.log(`Found ${posts.length} posts\n`);

      if (posts.length > 0) {
        posts.forEach((post, idx) => {
          const imageSize = post.image
            ? Buffer.byteLength(post.image, "utf8")
            : 0;
          const videoSize = post.video
            ? Buffer.byteLength(post.video, "utf8")
            : 0;
          const totalSize = imageSize + videoSize;

          console.log(`Post ${idx + 1}:`);
          console.log(`  ID: ${post._id}`);
          console.log(`  Owner: ${post.owner}`);
          console.log(`  Type: ${post.type}`);
          console.log(
            `  Image size: ${(imageSize / 1024 / 1024).toFixed(2)} MB`
          );
          console.log(
            `  Video size: ${(videoSize / 1024 / 1024).toFixed(2)} MB`
          );
          console.log(
            `  Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`
          );
          console.log(
            `  Is base64: ${
              post.image?.startsWith("data:") || post.video?.startsWith("data:")
            }`
          );
          console.log("");
        });
      }

      // Count total posts
      const totalCount = await postsCollection.countDocuments();
      console.log(`\nTotal posts in database: ${totalCount}`);

      // Get stats
      const stats = await db.command({ collStats: "posts" });
      console.log(
        `Average post size: ${(stats.avgObjSize / 1024).toFixed(2)} KB`
      );
      console.log(
        `Total data size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
      );
    } catch (queryError) {
      console.error("\n❌ Query failed!");
      console.error("Error:", queryError.message);
      console.error(
        "\nThis confirms the posts are too large to query efficiently."
      );
      console.error("\n💡 SOLUTIONS:");
      console.error(
        "1. Delete all posts and start fresh with cloud storage (Cloudinary/S3)"
      );
      console.error("2. Migrate existing posts to use URLs instead of base64");
      console.error("3. Increase MongoDB memory limit (not recommended)");
    }

    await mongoose.connection.close();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkPosts();
