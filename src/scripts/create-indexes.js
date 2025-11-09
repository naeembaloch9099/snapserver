const mongoose = require("mongoose");
require("dotenv").config();

async function createIndexes() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const db = mongoose.connection.db;

    console.log("Creating index on posts.createdAt...");
    await db.collection("posts").createIndex({ createdAt: -1 });
    console.log("✅ Index created: posts.createdAt (descending)");

    console.log("\nCreating compound index for better query performance...");
    await db.collection("posts").createIndex({ owner: 1, createdAt: -1 });
    console.log("✅ Index created: posts.owner + createdAt");

    console.log("\n=== CURRENT POST INDEXES ===");
    const indexes = await db.collection("posts").indexes();
    indexes.forEach((index) => {
      console.log(`  ${index.name}: ${JSON.stringify(index.key)}`);
    });

    await mongoose.connection.close();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

createIndexes();
