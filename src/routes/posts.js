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

const router = express.Router();

router.post("/", auth, createPost);
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
