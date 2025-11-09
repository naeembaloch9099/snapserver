const express = require("express");
const User = require("../models/User");
const auth = require("../middleware/auth");
const Notification = require("../models/Notification");

const router = express.Router();

// get user profile
router.get("/:id", auth, async (req, res) => {
  const { getProfile, followToggle } = require("../controllers/userController");

  const router = express.Router();

  router.get("/:id", auth, getProfile);
  router.post("/:id/follow", auth, followToggle);

  module.exports = router;
  res.json(user);
});
