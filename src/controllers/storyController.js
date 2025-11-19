const path = require("path");
const Story = require("../models/Story");
const Interaction = require("../models/Interaction");
const User = require("../models/User");
const { uploadFile } = require("../services/cloudinary");
const fetch = require("node-fetch");

// Upload a story: multipart form with file field `file`.
// Story is stored with expiresAt = now + 1 hour.
const uploadStory = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const uploadedFile = req.file;
    if (!uploadedFile) return res.status(400).json({ error: "Missing file" });

    const localPath = path.join(
      __dirname,
      "..",
      "..",
      "uploads",
      uploadedFile.filename
    );
    try {
      const folder = "snapgram/stories";
      const uploadResult = await uploadFile(localPath, {
        folder,
        resource_type: "auto",
      });
      const url = uploadResult.secure_url || uploadResult.url;
      const publicId = uploadResult.public_id;

      const expiresAt = new Date(Date.now() + 10 * 60 * 60 * 1000); // 10 hours

      const story = new Story({
        user: req.user._id,
        cloudinaryId: publicId,
        url,
        isPrivate: !!req.user.isPrivate,
        expiresAt,
        metadata: { resource_type: uploadResult.resource_type },
      });
      await story.save();
      return res.status(201).json(story);
    } catch (uploadErr) {
      console.warn("Cloudinary upload failed", uploadErr?.message || uploadErr);
      return res.status(500).json({ error: "Upload failed" });
    }
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/stories/feed - return grouped stories for accounts the viewer follows (or self)
const getFeed = async (req, res) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });

    // find candidate posters: users I follow plus myself
    const following = Array.isArray(viewer.following)
      ? viewer.following.map((f) => f._id || f)
      : [];
    const allowed = [
      ...new Set([...following.map(String), String(viewer._id)]),
    ];

    // Find non-expired stories from allowed posters, newest first
    const now = new Date();
    const stories = await Story.find({
      user: { $in: allowed },
      expiresAt: { $gt: now },
    })
      .sort({ createdAt: -1 })
      .lean();

    console.log(
      `[stories.getFeed] found ${stories.length} non-expired stories for allowed posters`
    );

    // Group by poster
    const groupsMap = {};
    for (const s of stories) {
      const pid = String(s.user);
      if (!groupsMap[pid])
        groupsMap[pid] = { userId: pid, stories: [], isPrivate: !!s.isPrivate };
      groupsMap[pid].stories.push(s);
    }

    const posterIds = Object.keys(groupsMap);
    console.log(`[stories.getFeed] posterIds:`, posterIds);

    // If no posters, return empty result early
    if (!posterIds || posterIds.length === 0) {
      return res.json([]);
    }

    // compute closeness scores using Interaction model helper
    let scores = {};
    try {
      scores = await Interaction.computeClosenessScores(viewer._id, posterIds);
      console.log(
        `[stories.getFeed] computed closeness scores for ${
          Object.keys(scores).length
        } posters`
      );
    } catch (scoreErr) {
      // don't fail the whole request for scoring errors; log and continue with zero scores
      console.warn(
        "[stories.getFeed] computeClosenessScores failed:",
        scoreErr && scoreErr.stack ? scoreErr.stack : scoreErr
      );
      scores = {};
    }

    // Attach user info and compute hasViewed for each group
    let users = [];
    try {
      users = await User.find({ _id: { $in: posterIds } })
        .select("username profilePic isPrivate")
        .lean();
      console.log(
        `[stories.getFeed] fetched ${users.length} user profiles for posters`
      );
    } catch (userErr) {
      console.warn(
        "[stories.getFeed] failed to fetch user profiles:",
        userErr && userErr.stack ? userErr.stack : userErr
      );
      users = [];
    }
    const userById = {};
    users.forEach((u) => (userById[String(u._id)] = u));

    const result = [];
    for (const pid of posterIds) {
      const g = groupsMap[pid];
      const user = userById[pid] || {};
      // determine hasViewed by checking view interactions for newest story
      const newest = (g.stories || [])[0];
      let hasViewed = false;
      if (newest) {
        try {
          const view = await Interaction.findOne({
            storyId: newest._id,
            userId: viewer._id,
            type: "view",
          }).lean();
          hasViewed = !!view;
        } catch (viewErr) {
          console.warn(
            `[stories.getFeed] view lookup failed for story ${newest._id}:`,
            viewErr && viewErr.stack ? viewErr.stack : viewErr
          );
          hasViewed = false;
        }
      }
      result.push({
        userId: pid,
        username: user.username || "",
        profilePic: user.profilePic || "",
        isPrivate: !!user.isPrivate,
        score: scores[pid] || 0,
        stories: g.stories,
        hasViewed,
      });
    }

    // Sort posters by score desc, then keep story order by createdAt desc inside group
    result.sort((a, b) => b.score - a.score);

    return res.json(result);
  } catch (e) {
    // log full error server-side for debugging
    console.error("[stories.getFeed] error:", e && e.stack ? e.stack : e);
    const msg =
      process.env.NODE_ENV !== "production"
        ? e && e.message
          ? e.message
          : String(e)
        : "Server error";
    res.status(500).json({ error: msg });
  }
};

// POST /api/stories/:id/log_interaction
const logInteraction = async (req, res) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    const { type = "view", metadata = {} } = req.body || {};
    if (!["view", "reply", "reaction"].includes(type))
      return res.status(400).json({ error: "Invalid type" });

    const story = await Story.findById(id);
    if (!story) return res.status(404).json({ error: "Story not found" });

    // Respect privacy: only allow interactions if the story belongs to someone the viewer follows or self
    const isAllowed =
      String(story.user) === String(viewer._id) ||
      (viewer.following || []).some(
        (f) => String(f._id || f) === String(story.user)
      );
    if (!isAllowed) return res.status(403).json({ error: "Not allowed" });

    const doc = new Interaction({
      storyId: story._id,
      userId: viewer._id,
      type,
      metadata,
    });
    await doc.save();
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = { uploadStory, getFeed, logInteraction };

// DEBUG: return all stories (dev only)
const debugAllStories = async (req, res) => {
  try {
    const stories = await Story.find({}).sort({ createdAt: -1 }).lean();
    return res.json({ count: stories.length, stories });
  } catch (e) {
    console.error("[stories.debugAll]", e && e.stack ? e.stack : e);
    return res.status(500).json({
      error:
        process.env.NODE_ENV !== "production"
          ? e && e.message
            ? e.message
            : String(e)
          : "Server error",
    });
  }
};

// Exported functions (initial set)
// Note: final consolidated export will be at the end of the file.

// (kept for backwards-compatibility during incremental edits)

// Proxy a story media URL through the server for authenticated clients.
const proxyStory = async (req, res) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    const story = await Story.findById(id).lean();
    if (!story) return res.status(404).json({ error: "Story not found" });

    // Allow only if owner or follower
    const isAllowed =
      String(story.user) === String(viewer._id) ||
      (viewer.following || []).some(
        (f) => String(f._id || f) === String(story.user)
      );
    if (!isAllowed) return res.status(403).json({ error: "Not allowed" });

    const upstreamUrl = story.url;
    if (!upstreamUrl) return res.status(404).json({ error: "No media URL" });

    // Forward Range header if provided to support partial content
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const upstreamRes = await fetch(upstreamUrl, { method: "GET", headers });
    // forward status and selected headers
    res.status(upstreamRes.status);
    const ct = upstreamRes.headers.get("content-type");
    const cl = upstreamRes.headers.get("content-length");
    const acceptRanges = upstreamRes.headers.get("accept-ranges");
    const contentRange = upstreamRes.headers.get("content-range");
    if (ct) res.setHeader("content-type", ct);
    if (cl) res.setHeader("content-length", cl);
    if (acceptRanges) res.setHeader("accept-ranges", acceptRanges);
    if (contentRange) res.setHeader("content-range", contentRange);

    // Stream the body to the client with safe error/close handling
    const body = upstreamRes.body;
    if (!body) return res.end();

    // Forward any upstream stream errors to the response and log them
    body.on("error", (err) => {
      console.error(
        `[stories.proxyStory] upstream stream error for ${id}:`,
        err && err.stack ? err.stack : err
      );
      try {
        if (!res.headersSent) {
          res.status(500).json({ error: "Proxy stream error" });
        } else {
          res.destroy(err);
        }
      } catch (e) {
        // swallow errors while trying to notify client
      }
    });

    // If client closes connection, destroy upstream body to free resources
    res.on("close", () => {
      try {
        if (body.destroy) body.destroy();
      } catch (e) {
        /* ignore */
      }
    });

    body.pipe(res);
  } catch (e) {
    console.error("[stories.proxyStory] error:", e && e.stack ? e.stack : e);
    res.status(500).json({ error: "Proxy failed" });
  }
};

// keep definitions above; final export block will export everything together

// GET /api/stories/:id/viewers - return list of viewers for a story (owner only)
const getViewers = async (req, res) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    const story = await Story.findById(id).lean();
    if (!story) return res.status(404).json({ error: "Story not found" });

    // Only the owner of the story may fetch the viewers list
    if (String(story.user) !== String(viewer._id))
      return res.status(403).json({ error: "Forbidden" });

    const Interaction = require("../models/Interaction");
    const views = await Interaction.find({ storyId: story._id, type: "view" })
      .sort({ createdAt: -1 })
      .populate("userId", "username profilePic")
      .lean();

    const result = views.map((v) => ({
      userId: v.userId?._id || null,
      username: v.userId?.username || "",
      profilePic: v.userId?.profilePic || "",
      viewedAt: v.createdAt,
      likedByOwner: false,
    }));

    // Determine which viewers the owner has 'hearted' (reaction)
    try {
      const viewerIds = result.map((r) => r.userId).filter(Boolean);
      if (viewerIds.length > 0) {
        const reactions = await Interaction.find({
          storyId: story._id,
          type: "reaction",
          userId: viewer._id, // owner
          "metadata.targetUserId": { $in: viewerIds },
        }).lean();
        const likedSet = new Set(
          reactions.map((r) => String(r.metadata?.targetUserId))
        );
        result.forEach((r) => {
          if (r.userId && likedSet.has(String(r.userId))) r.likedByOwner = true;
        });
      }
    } catch (e) {
      console.warn("[stories.getViewers] failed to fetch owner reactions:", e);
    }

    return res.json({ count: result.length, viewers: result });
  } catch (e) {
    console.error("[stories.getViewers] error:", e && e.stack ? e.stack : e);
    return res.status(500).json({ error: "Server error" });
  }
};

// DELETE /api/stories/:id/reaction?targetUserId=... - remove an owner's reaction to a viewer
const removeReaction = async (req, res) => {
  try {
    const viewer = req.user; // the authenticated user (should be owner)
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    const targetUserId = req.query.targetUserId;
    if (!targetUserId)
      return res.status(400).json({ error: "Missing targetUserId" });

    const story = await Story.findById(id).lean();
    if (!story) return res.status(404).json({ error: "Story not found" });

    // Only story owner may remove their own reaction
    if (String(story.user) !== String(viewer._id))
      return res.status(403).json({ error: "Forbidden" });

    const Interaction = require("../models/Interaction");
    const del = await Interaction.findOneAndDelete({
      storyId: story._id,
      userId: viewer._id,
      type: "reaction",
      "metadata.targetUserId": targetUserId,
      "metadata.reaction": "heart",
    });

    if (!del) return res.status(404).json({ error: "Reaction not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error(
      "[stories.removeReaction] error:",
      e && e.stack ? e.stack : e
    );
    return res.status(500).json({ error: "Server error" });
  }
};

// DELETE /api/stories/:id - delete a story (owner only)
const deleteStory = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    const story = await Story.findById(id);
    if (!story) return res.status(404).json({ error: "Story not found" });

    // Only owner may delete
    if (String(story.user) !== String(user._id))
      return res.status(403).json({ error: "Forbidden" });

    // Delete interactions referencing this story
    try {
      const Interaction = require("../models/Interaction");
      const deleted = await Interaction.deleteMany({ storyId: story._id });
      console.log(
        `Deleted ${deleted.deletedCount || 0} interactions for story ${id}`
      );
    } catch (e) {
      console.warn("Failed to delete story interactions:", e?.message || e);
    }

    // Remove Cloudinary asset if present
    try {
      if (story.cloudinaryId) {
        const { cloudinary } = require("../services/cloudinary");
        await cloudinary.uploader.destroy(story.cloudinaryId, {
          resource_type: "auto",
        });
        console.log(`Deleted cloudinary asset for story ${id}`);
      }
    } catch (e) {
      console.warn(
        "Failed to remove cloudinary asset for story:",
        e?.message || e
      );
    }

    await Story.deleteOne({ _id: story._id });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[stories.deleteStory] error:", e && e.stack ? e.stack : e);
    return res.status(500).json({ error: "Server error" });
  }
};

// Final consolidated export
module.exports = {
  uploadStory,
  getFeed,
  logInteraction,
  debugAllStories,
  proxyStory,
  getViewers,
  removeReaction,
  deleteStory,
};
