const express = require("express");
const auth = require("../middleware/auth");
const {
  getProfile,
  followToggle,
  acceptFollowRequest,
  rejectFollowRequest,
  searchUsers,
  removeFollower,
} = require("../controllers/userController");

const router = express.Router();

// search users by username prefix
router.get("/search", auth, searchUsers);
// update current authenticated user's profile
router.patch("/me", auth, async (req, res) => {
  const { updateProfile } = require("../controllers/userController");
  return updateProfile(req, res);
});
router.get("/:id", auth, getProfile);
router.post("/:id/follow", auth, followToggle);
// accept or reject a follow request (owner only)
router.post("/:id/requests/:requesterId/accept", auth, acceptFollowRequest);
router.post("/:id/requests/:requesterId/reject", auth, rejectFollowRequest);
// remove a follower from own followers list
router.post("/followers/:followerId/remove", auth, removeFollower);

module.exports = router;
