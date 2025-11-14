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

// Get random user suggestions
router.get("/suggestions", auth, async (req, res) => {
  try {
    const User = require("../models/User");
    const limit = parseInt(req.query.limit) || 3;
    const currentUserId = req.user._id;

    // Get random users excluding current user and already followed users
    const currentUser = await User.findById(currentUserId);
    const followingIds = currentUser.following || [];

    const suggestions = await User.aggregate([
      {
        $match: {
          _id: {
            $ne: currentUserId,
            $nin: followingIds,
          },
          verified: true,
        },
      },
      { $sample: { size: limit } },
      {
        $project: {
          username: 1,
          name: 1,
          profilePic: 1,
          bio: 1,
          followersCount: { $size: { $ifNull: ["$followers", []] } },
          isPrivate: 1,
        },
      },
    ]);

    res.json(suggestions);
  } catch (e) {
    console.error("GET /users/suggestions error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Get current authenticated user's profile
router.get("/me", auth, async (req, res) => {
  try {
    // req.user is set by auth middleware
    const user = req.user;
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Return user data (excluding sensitive fields)
    res.json({
      id: user._id,
      _id: user._id,
      username: user.username,
      name: user.name,
      email: user.email,
      profilePic: user.profilePic,
      bio: user.bio,
      isPrivate: user.isPrivate,
      followersCount: user.followers ? user.followers.length : 0,
      followingCount: user.following ? user.following.length : 0,
      followers: user.followers || [],
      following: user.following || [],
      followRequests: user.followRequests || [],
    });
  } catch (e) {
    console.error("GET /users/me error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

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
