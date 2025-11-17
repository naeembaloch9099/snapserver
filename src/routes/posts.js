const express = require("express");
const auth = require("../middleware/auth");
const {
  createPost,
  getFeed,
  toggleLike,
  addComment,
  toggleCommentLike,
  toggleRepost,
  updatePost,
  deletePost,
} = require("../controllers/postController");

const path = require("path");
const multer = require("multer");

// Prepare multer storage for post media uploads (same uploads folder)
const uploadDir = path.join(__dirname, "..", "..", "uploads");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
  },
});
const upload = multer({ storage });

const router = express.Router();

// Accept multipart/form-data with optional file field named `file`
router.post("/", auth, upload.single("file"), createPost);
// public feed - allow unauthenticated access to browse posts
router.get("/", getFeed);
router.post("/:id/like", auth, toggleLike);
router.post("/:id/comment", auth, addComment);
// like a comment on a post
router.post("/:postId/comment/:commentId/like", auth, toggleCommentLike);
router.post("/:id/repost", auth, toggleRepost);

// edit caption (owner only)
router.patch("/:id", auth, updatePost);

// delete post (owner only)
router.delete("/:id", auth, deletePost);

module.exports = router;
