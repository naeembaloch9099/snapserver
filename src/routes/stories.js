const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const path = require("path");
const multer = require("multer");
const {
  uploadStory,
  getFeed,
  logInteraction,
} = require("../controllers/storyController");

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

// Log interaction (view/reply/reaction)
router.post("/:id/log_interaction", auth, logInteraction);

module.exports = router;
