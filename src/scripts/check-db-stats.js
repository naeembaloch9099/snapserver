const mongoose = require("mongoose");
require("dotenv").config();

async function checkDatabaseStats() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    const db = mongoose.connection.db;

    // Get server status
    const serverStatus = await db.admin().serverStatus();

    console.log("=== MEMORY USAGE ===");
    console.log(
      `Resident Memory: ${(serverStatus.mem.resident / 1024).toFixed(2)} GB`
    );
    console.log(
      `Virtual Memory: ${(serverStatus.mem.virtual / 1024).toFixed(2)} GB`
    );
    console.log(
      `Mapped Memory: ${
        serverStatus.mem.mapped
          ? (serverStatus.mem.mapped / 1024).toFixed(2) + " GB"
          : "N/A"
      }`
    );

    console.log("\n=== DATABASE STATS ===");
    const dbStats = await db.stats();
    console.log(`Database: ${dbStats.db}`);
    console.log(`Collections: ${dbStats.collections}`);
    console.log(`Data Size: ${(dbStats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(
      `Storage Size: ${(dbStats.storageSize / 1024 / 1024).toFixed(2)} MB`
    );
    console.log(`Indexes: ${dbStats.indexes}`);
    console.log(
      `Index Size: ${(dbStats.indexSize / 1024 / 1024).toFixed(2)} MB`
    );

    console.log("\n=== COLLECTION STATS ===");
    const collections = await db.listCollections().toArray();

    for (const coll of collections) {
      const collStats = await db.command({ collStats: coll.name });
      console.log(`\n${coll.name}:`);
      console.log(`  Documents: ${collStats.count.toLocaleString()}`);
      console.log(`  Size: ${(collStats.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(
        `  Avg Doc Size: ${(collStats.avgObjSize / 1024).toFixed(2)} KB`
      );
      console.log(
        `  Storage Size: ${(collStats.storageSize / 1024 / 1024).toFixed(2)} MB`
      );
      console.log(`  Indexes: ${collStats.nindexes}`);
      console.log(
        `  Index Size: ${(collStats.totalIndexSize / 1024 / 1024).toFixed(
          2
        )} MB`
      );
    }

    console.log("\n=== SORT MEMORY LIMIT ===");
    console.log("Default MongoDB sort memory limit: 32 MB (33,554,432 bytes)");
    console.log(
      "⚠️  Queries that exceed this limit need allowDiskUse:true option"
    );

    // Check if there's an index on createdAt for posts
    console.log("\n=== POST INDEXES ===");
    const postIndexes = await db.collection("posts").indexes();
    postIndexes.forEach((index) => {
      console.log(`  ${index.name}: ${JSON.stringify(index.key)}`);
    });

    await mongoose.connection.close();
    console.log("\n✅ Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkDatabaseStats();
