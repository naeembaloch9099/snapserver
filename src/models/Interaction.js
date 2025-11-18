const mongoose = require("mongoose");
const { Schema } = mongoose;

const InteractionSchema = new Schema(
  {
    storyId: {
      type: Schema.Types.ObjectId,
      ref: "Story",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["view", "reply", "reaction"], required: true },
    metadata: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

// Compound index to speed up queries by viewer and type
InteractionSchema.index({ userId: 1, type: 1, createdAt: -1 });

/**
 * Compute closeness scores for a set of posterIds for a given viewer
 * Returns an object mapping posterId -> score
 */
InteractionSchema.statics.computeClosenessScores = async function (
  viewerId,
  posterIds
) {
  const Story = require("./Story");
  const Interaction = this;
  if (!Array.isArray(posterIds) || posterIds.length === 0) return {};

  const posterObjIds = posterIds.map((p) => mongoose.Types.ObjectId(String(p)));

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Aggregate interactions joined with stories to compute per-poster stats
  const agg = [
    // join story to get poster
    {
      $lookup: {
        from: "stories",
        localField: "storyId",
        foreignField: "_id",
        as: "story",
      },
    },
    { $unwind: "$story" },
    // Filter to this viewer and only posters in our list
    {
      $match: {
        userId: mongoose.Types.ObjectId(String(viewerId)),
        "story.user": { $in: posterObjIds },
      },
    },
    // group by poster and type/time buckets
    {
      $group: {
        _id: { poster: "$story.user", type: "$type" },
        count: { $sum: 1 },
        latest: { $max: "$createdAt" },
      },
    },
  ];

  const rows = await Interaction.aggregate(agg).allowDiskUse(true);

  const scores = {};
  posterObjIds.forEach((p) => (scores[String(p)] = 0));

  for (const r of rows) {
    const posterId = String(r._id.poster);
    const type = r._id.type;
    if (!scores[posterId]) scores[posterId] = 0;
    if (type === "reply") {
      // check reply recency (last 7 days)
      if (r.latest && new Date(r.latest) >= since7d) scores[posterId] += 100;
    }
    if (type === "reaction") {
      // each reaction in last 24 hours counts +10
      // conservatively treat count as reactions in the aggregation
      // but ensure recency by comparing at least one latest timestamp
      if (r.latest && new Date(r.latest) >= since24h)
        scores[posterId] += 10 * r.count;
    }
  }

  return scores;
};

module.exports = mongoose.model("Interaction", InteractionSchema);
