const express = require("express");
const router = express.Router();

// Simple legal endpoints that return stub text. Replace with database
// or markdown loading if you want dynamic content later.
router.get("/privacy", (req, res) => {
  return res.json({
    ok: true,
    title: "Privacy Policy",
    content:
      "This is the SnapGram privacy policy placeholder. Replace with your official privacy policy text.",
  });
});

router.get("/terms", (req, res) => {
  return res.json({
    ok: true,
    title: "Terms of Service",
    content:
      "This is the SnapGram Terms of Service placeholder. Replace with your official terms text.",
  });
});

module.exports = router;
