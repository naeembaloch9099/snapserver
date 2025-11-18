const path = require("path");
const Story = require("../models/Story");
const Interaction = require("../models/Interaction");
const User = require("../models/User");
const { uploadFile } = require("../services/cloudinary");

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

      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

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

    // Group by poster
    const groupsMap = {};
    for (const s of stories) {
      const pid = String(s.user);
      if (!groupsMap[pid])
        groupsMap[pid] = { userId: pid, stories: [], isPrivate: !!s.isPrivate };
      groupsMap[pid].stories.push(s);
    }

    const posterIds = Object.keys(groupsMap);

    // compute closeness scores using Interaction model helper
    const scores = await Interaction.computeClosenessScores(
      viewer._id,
      posterIds
    );

    // Attach user info and compute hasViewed for each group
    const users = await User.find({ _id: { $in: posterIds } })
      .select("username profilePic isPrivate")
      .lean();
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
        const view = await Interaction.findOne({
          storyId: newest._id,
          userId: viewer._id,
          type: "view",
        }).lean();
        hasViewed = !!view;
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
    console.warn(e);
    res.status(500).json({ error: "Server error" });
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
