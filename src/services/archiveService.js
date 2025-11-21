const Story = require("../models/Story");

/**
 * Auto-archive all expired stories globally (runs in background)
 * This runs periodically to clean up expired stories and move them to archive
 */
const autoArchiveExpiredStories = async () => {
  try {
    const now = new Date();

    // Find all expired stories that aren't archived yet
    const expiredStories = await Story.updateMany(
      {
        expiresAt: { $lt: now },
        isArchived: false,
      },
      {
        $set: {
          isArchived: true,
          archivedAt: now,
        },
      }
    );

    if (expiredStories.modifiedCount > 0) {
      console.log(
        `[archiveService] Auto-archived ${expiredStories.modifiedCount} expired stories`
      );
    }

    return expiredStories.modifiedCount;
  } catch (e) {
    console.error("[archiveService] Error auto-archiving expired stories:", e);
  }
};

/**
 * Start background job to auto-archive expired stories every 5 minutes
 */
const startArchiveWorker = () => {
  // Run immediately on startup
  autoArchiveExpiredStories();

  // Then run every 5 minutes
  const intervalId = setInterval(async () => {
    await autoArchiveExpiredStories();
  }, 5 * 60 * 1000); // 5 minutes

  console.log("[archiveService] Archive worker started (runs every 5 minutes)");

  return intervalId;
};

module.exports = {
  autoArchiveExpiredStories,
  startArchiveWorker,
};
