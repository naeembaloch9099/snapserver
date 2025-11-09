const express = require("express");
const auth = require("../middleware/auth");
const path = require("path");
const multer = require("multer");
const {
  getOrCreateConversation,
  getMessages,
  markSeen,
  listConversations,
  sendMessage,
} = require("../controllers/messageController");

const router = express.Router();

// Prepare multer storage for message media uploads
const uploadDir = path.join(__dirname, "..", "..", "uploads");
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
  },
});
const upload = multer({ storage });

// list conversations (inbox)
router.get("/", auth, listConversations);

router.post("/conversation", auth, getOrCreateConversation);
router.get("/conversation/:conversationId/messages", auth, getMessages);
router.post("/conversation/:conversationId/seen", auth, markSeen);

// Accept multipart/form-data for message with file field named `file`
router.post("/:conversationId", auth, upload.single("file"), sendMessage);

module.exports = router;
