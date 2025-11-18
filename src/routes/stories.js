const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const path = require("path");
const multer = require("multer");
const controllers = require("../controllers/storyController");
const { uploadStory, getFeed, logInteraction, proxyStory, getViewers } =
  controllers;

// multer storage setup (same uploads folder as posts)
const uploadDir = path.join(__dirname, "..", "..", "uploads");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
  },
});
const upload = multer({ storage });

// Upload story (authenticated)
router.post("/upload", auth, upload.single("file"), uploadStory);

// Get feed (authenticated)
router.get("/feed", auth, getFeed);

// DEBUG: return all stories (dev-only)
router.get("/debug_all", auth, (req, res) => {
  // only allow debug in non-production to avoid exposing data in prod
  if (process.env.NODE_ENV === "production")
    return res.status(403).json({ error: "Forbidden" });
  const { debugAllStories } = require("../controllers/storyController");
  return debugAllStories(req, res);
});

// Log interaction (view/reply/reaction)
router.post("/:id/log_interaction", auth, logInteraction);

// Proxy story media for authenticated clients
router.get("/proxy/:id", auth, proxyStory);

// viewers list for a story (owner-only)
router.get("/:id/viewers", auth, getViewers);

module.exports = router;
