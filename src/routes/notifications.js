const express = require("express");
const auth = require("../middleware/auth");
const {
  listNotifications,
  markRead,
  deleteNotification,
} = require("../controllers/notificationController");

const router = express.Router();

router.get("/", auth, listNotifications);
router.post("/read", auth, markRead); // mark all read
router.delete("/:id", auth, deleteNotification); // delete a notification

module.exports = router;
