// src/routes/stories.js

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const path = require("path");
const multer = require("multer");
// Ensure this file exists and exports all required functions
const storyController = require("../controllers/storyController");

// Helper to ensure a handler is a function, otherwise provide a helpful 501 responder
const ensureHandler = (fn, name) => {
  if (typeof fn === "function") return fn;
  console.warn(
    `[stories.routes] controller handler missing: ${name}. CHECK EXPORTS!`
  );
  return (req, res) =>
    res
      .status(501)
      .json({ error: `Handler ${name} not implemented or failed to load` });
};

// --- Controller Function Mapping (If any of these are UNDEFINED, the server crashes) ---
const uploadStory = ensureHandler(storyController.uploadStory, "uploadStory");
const getFeed = ensureHandler(storyController.getFeed, "getFeed"); // <-- Check this one (used on line 47)
const logInteraction = ensureHandler(
  storyController.logInteraction,
  "logInteraction"
);
const proxyStory = ensureHandler(storyController.proxyStory, "proxyStory");
const getStoryViewers = ensureHandler(
  storyController.getStoryViewers,
  "getStoryViewers"
);
const debugAllStories = ensureHandler(
  storyController.debugAllStories,
  "debugAllStories"
); // Added check for the debug handler

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

// Get feed (authenticated) - LINE 47
router.get("/feed", auth, getFeed); // CRASH occurs here if getFeed is undefined

// DEBUG: return all stories (dev-only)
router.get("/debug_all", auth, (req, res) => {
  // only allow debug in non-production to avoid exposing data in prod
  if (process.env.NODE_ENV === "production")
    return res.status(403).json({ error: "Forbidden" });
  // Call the ensured handler directly
  return debugAllStories(req, res);
});

// Log interaction (view/reply/reaction)
router.post("/:id/log_interaction", auth, logInteraction);

// Proxy story media for authenticated clients
router.get("/proxy/:id", auth, proxyStory);

// Get viewers for a story (owner only)
router.get("/:id/viewers", auth, getStoryViewers);

module.exports = router;
