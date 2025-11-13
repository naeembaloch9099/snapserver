const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const PendingUser = require("../models/PendingUser");

const router = express.Router();

// --- Token & Cookie Helpers ---

const signAccess = (user) => {
  return jwt.sign(
    { sub: user._id, username: user.username },
    process.env.JWT_ACCESS_SECRET || "access-secret",
    { expiresIn: "15m" }
  );
};

const signRefresh = (user) => {
  return jwt.sign(
    { sub: user._id },
    process.env.JWT_REFRESH_SECRET || "refresh-secret",
    { expiresIn: "7d" }
  );
};

/**
 * ✅ [THE FIX] Creates a consistent set of cookie options.
 * This function is used to set AND clear the cookie,
 * which solves the "zombie cookie" bug.
 */
const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true, // Cannot be accessed by client-side JS
    secure: isProduction, // Only send over HTTPS in production
    sameSite: isProduction ? "none" : "lax", // 'none' for cross-domain prod, 'lax' for dev
    path: "/", // Make cookie available to the entire site
  };
};

// --- Auth Routes ---

// Check username availability and suggest alternatives
router.post("/check-username", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });

    // Validate format
    const usernameRegex = /^[a-z0-9_.-]+$/;
    if (!usernameRegex.test(username)) {
      return res.json({
        available: false,
        message:
          "Username can only contain lowercase letters, digits, and special characters (. - _). No spaces allowed.",
        suggestions: [],
      });
    }

    // Check if taken
    const existing = await User.findOne({ username });
    const pendingExisting = await PendingUser.findOne({ username });

    if (existing || pendingExisting) {
      // Generate suggestions
      const suggestions = [];
      for (let i = 1; suggestions.length < 3; i++) {
        const suggestion = `${username}${Math.floor(Math.random() * 1000)}`;
        const suggestionExists = await User.findOne({ username: suggestion });
        const suggestionPending = await PendingUser.findOne({
          username: suggestion,
        });
        if (!suggestionExists && !suggestionPending) {
          suggestions.push(suggestion);
        }
      }

      return res.json({
        available: false,
        message: "Username is already taken",
        suggestions,
      });
    }

    return res.json({ available: true, message: "Username is available" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Resend OTP
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const pending = await PendingUser.findOne({ email });
    if (!pending)
      return res.status(400).json({ error: "No pending registration found" });

    const otp = String(crypto.randomInt(100000, 1000000));
    const expires = new Date(Date.now() + 1000 * 60 * 2); // 2 minutes
    const otpHash = await bcrypt.hash(otp, 10);

    pending.verifyOTP = otpHash;
    pending.verifyOTPExpires = expires;
    await pending.save();

    try {
      const { sendMail } = require("../utils/mailer");
      await sendMail({
        to: pending.email,
        subject: "Verify your SnapGram account - New Code",
        text: `Your new verification code: ${otp}\n\nThis code will expire in 2 minutes.`,
        html: `<h2>New Verification Code</h2><p>Your verification code is: <strong>${otp}</strong></p><p>This code will expire in 2 minutes.</p>`,
      });
      return res.json({ ok: true });
    } catch (mailErr) {
      console.warn("resend-otp: mail send failed", mailErr);
      return res
        .status(500)
        .json({ error: "Failed to send verification email" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// register (create pending account and send OTP)
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, name, profilePic, bio } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: "Missing fields" });

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) return res.status(400).json({ error: "User exists" });

    const existingPending = await PendingUser.findOne({
      $or: [{ username }, { email }],
    });

    // Validate username format: lowercase, digits, special chars, no spaces
    const usernameRegex = /^[a-z0-9_.-]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        error:
          "Username can only contain lowercase letters, digits, and special characters (. - _). No spaces allowed.",
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const otp = String(crypto.randomInt(100000, 1000000));
    const expires = new Date(Date.now() + 1000 * 60 * 2); // 2 minutes expiry
    const otpHash = await bcrypt.hash(otp, 10);

    let pending;
    if (existingPending) {
      existingPending.passwordHash = hash;
      existingPending.name = name;
      existingPending.profilePic = profilePic;
      existingPending.bio = bio;
      existingPending.verifyOTP = otpHash;
      existingPending.verifyOTPExpires = expires;
      pending = await existingPending.save();
    } else {
      pending = await PendingUser.create({
        username,
        email,
        passwordHash: hash,
        name,
        profilePic,
        bio,
        verifyOTP: otpHash,
        verifyOTPExpires: expires,
      });
    }

    try {
      const { sendMail } = require("../utils/mailer");
      const info = await sendMail({
        to: pending.email,
        subject: "Verify your SnapGram account",
        text: `Your verification code: ${otp}\n\nThis code will expire in 2 minutes.`,
        html: `<h2>Welcome to SnapGram!</h2><p>Your verification code is: <strong>${otp}</strong></p><p>This code will expire in 2 minutes.</p>`,
      });
      // NEVER send OTP in response - only via email
      return res.json({ ok: true });
    } catch (mailErr) {
      console.warn("register: mail send failed", mailErr);
      return res
        .status(500)
        .json({ error: "Failed to send verification email" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// forgot password
router.post("/forgot", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ ok: true }); // avoid revealing user existence

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    user.resetOTP = otpHash;
    user.resetOTPExpires = new Date(Date.now() + 1000 * 60 * 2); // 2 minutes expiry
    await user.save();

    try {
      const { sendMail } = require("../utils/mailer");
      const info = await sendMail({
        to: user.email,
        subject: "Reset your SnapGram password",
        text: `Your OTP: ${otp}\n\nThis code will expire in 2 minutes.`,
        html: `<h2>Password Reset</h2><p>Your OTP is: <strong>${otp}</strong></p><p>This code will expire in 2 minutes.</p>`,
      });
      // NEVER send OTP in response
      return res.json({ ok: true });
    } catch (mailErr) {
      console.warn("forgot: mail send failed", mailErr);
      return res.status(500).json({ error: "Failed to send OTP" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// reset password with OTP
router.post("/reset", async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password)
      return res.status(400).json({ error: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid" });

    if (
      !user.resetOTP ||
      !user.resetOTPExpires ||
      user.resetOTPExpires < new Date()
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const okReset = await bcrypt.compare(String(otp), String(user.resetOTP));
    if (!okReset)
      return res.status(400).json({ error: "Invalid or expired OTP" });

    const hash = await bcrypt.hash(password, 10);
    user.passwordHash = hash;
    user.resetOTP = undefined;
    user.resetOTPExpires = undefined;
    await user.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// verify account OTP and activate account (issue tokens)
router.post("/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ error: "Missing fields" });

    const pending = await PendingUser.findOne({ email });
    if (!pending)
      return res.status(400).json({ error: "Invalid or expired OTP" });

    if (
      !pending.verifyOTP ||
      !pending.verifyOTPExpires ||
      pending.verifyOTPExpires < new Date()
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const okVerify = await bcrypt.compare(
      String(otp),
      String(pending.verifyOTP)
    );
    if (!okVerify)
      return res.status(400).json({ error: "Invalid or expired OTP" });

    const newUser = await User.create({
      username: pending.username,
      email: pending.email,
      passwordHash: pending.passwordHash,
      name: pending.name,
      profilePic: pending.profilePic,
      bio: pending.bio,
      verified: true,
    });

    await PendingUser.deleteOne({ _id: pending._id });

    const access = signAccess(newUser);
    const refresh = signRefresh(newUser);
    newUser.refreshTokens.push({ tokenHash: refresh, createdAt: new Date() });
    await newUser.save(); // ✅ [FIX] Use the consistent cookie options

    res.cookie("refreshToken", refresh, getCookieOptions());

    return res.json({
      access,
      user: {
        id: newUser._id,
        username: newUser.username,
        name: newUser.name,
        profilePic: newUser.profilePic,
        bio: newUser.bio,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Missing fields" });

    const user = await User.findOne({
      $or: [{ username }, { email: username }],
    });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    if (!user.verified)
      return res.status(403).json({ error: "Account not verified" });

    const access = signAccess(user);
    const refresh = signRefresh(user);
    user.refreshTokens.push({ tokenHash: refresh, createdAt: new Date() });
    await user.save(); // ✅ [FIX] Use the consistent cookie options

    res.cookie("refreshToken", refresh, getCookieOptions()); // Return the full user object for the AuthContext

    return res.json({
      access,
      user: {
        id: user._id,
        _id: user._id,
        username: user.username,
        name: user.name,
        profilePic: user.profilePic,
        bio: user.bio,
        isPrivate: user.isPrivate,
        followersCount: user.followers ? user.followers.length : 0,
        followingCount: user.following ? user.following.length : 0,
        followers: user.followers || [],
        following: user.following || [],
        followRequests: user.followRequests || [],
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// refresh
router.post("/refresh", async (req, res) => {
  try {
    // Add console logs for debugging
    console.log("\n[REFRESH] -------------------------");
    console.log("[REFRESH] Attempting to refresh token...");
    const token = req.cookies.refreshToken;

    if (!token) {
      console.log("[REFRESH] ❌ Error: No refresh token found in cookies.");
      return res.status(401).json({ error: "No refresh token" });
    }

    console.log(`[REFRESH] ✅ Token found: ${token.substring(0, 10)}...`);
    const payload = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || "refresh-secret"
    );

    const user = await User.findById(payload.sub);
    if (!user) {
      console.log("[REFRESH] ❌ Error: User not found for token.");
      return res.status(401).json({ error: "User not found" });
    }

    console.log(`[REFRESH] ✅ User found: ${user.username}`);
    const found = user.refreshTokens.find((r) => r.tokenHash === token);
    if (!found) {
      console.log(
        "[REFRESH] ❌ Error: Token not recognized in database (token reuse?)."
      );
      return res.status(401).json({ error: "Refresh token not recognized" });
    }

    console.log("[REFRESH] ✅ Token validated. Issuing new tokens.");
    const access = signAccess(user);
    const refresh = signRefresh(user); // Rotate token: remove old, add new

    user.refreshTokens = user.refreshTokens.filter(
      (r) => r.tokenHash !== token
    );
    user.refreshTokens.push({ tokenHash: refresh, createdAt: new Date() });
    await user.save(); // ✅ [FIX] Use the consistent cookie options

    res.cookie("refreshToken", refresh, getCookieOptions()); // Return the full user object for the AuthContext

    return res.json({
      access,
      user: {
        id: user._id,
        _id: user._id,
        username: user.username,
        name: user.name,
        profilePic: user.profilePic, // <-- THIS IS THE LINE I FIXED
        bio: user.bio,
        isPrivate: user.isPrivate,
        followersCount: user.followers ? user.followers.length : 0,
        followingCount: user.following ? user.following.length : 0,
        followers: user.followers || [],
        following: user.following || [],
        followRequests: user.followRequests || [],
      },
    });
  } catch (e) {
    console.warn("[REFRESH] ❌ GENERAL ERROR:", e.message);
    return res.status(401).json({ error: "Invalid refresh" });
  }
});

// logout
router.post("/logout", async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      try {
        const payload = jwt.verify(
          token,
          process.env.JWT_REFRESH_SECRET || "refresh-secret"
        );
        const user = await User.findById(payload.sub);
        if (user) {
          user.refreshTokens = user.refreshTokens.filter(
            (r) => r.tokenHash !== token
          );
          await user.save();
        }
      } catch (e) {
        // ignore errors if token is invalid or expired
      }
    }
    /**
     * ✅ [THE BUG FIX]
     * Clear the cookie using the exact same options it was set with.
     * This will now reliably delete the cookie from the browser.
     */

    res.clearCookie("refreshToken", getCookieOptions());

    return res.json({ ok: true });
  } catch (e) {
    console.warn(e);
    res.status(500).json({ error: "Server error" });
  }
});

// change password (authenticated)
router.post("/password", require("../middleware/auth"), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword)
      return res.status(400).json({ error: "Missing fields" });
    if (String(newPassword).length < 6)
      return res.status(400).json({ error: "Password too short" });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const ok = await bcrypt.compare(String(oldPassword), user.passwordHash);
    if (!ok)
      return res.status(400).json({ error: "Current password incorrect" });

    const hash = await bcrypt.hash(String(newPassword), 10);
    user.passwordHash = hash;
    await user.save();

    return res.json({ ok: true, message: "Password changed" });
  } catch (e) {
    console.error("[CHANGE PASSWORD] Error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// delete account (requires authentication)
router.delete("/account", require("../middleware/auth"), async (req, res) => {
  try {
    const userId = req.user._id;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`🗑️ [DELETE ACCOUNT] User ID: ${userId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const username = user.username;
    console.log(`👤 [DELETE ACCOUNT] Username: ${username}`);

    const Post = require("../models/Post");
    // ✅ FIX: Use owner: userId (ObjectId) not username
    const deletedPosts = await Post.deleteMany({ owner: userId });
    console.log(`📝 [DELETE] Deleted ${deletedPosts.deletedCount} posts`);

    const Comment = require("../models/Comment");
    // ✅ FIX: Use user: userId (field name in Comment model is 'user' not 'author')
    const deletedComments = await Comment.deleteMany({ user: userId });
    console.log(`💬 [DELETE] Deleted ${deletedComments.deletedCount} comments`);

    const Notification = require("../models/Notification");
    const deletedNotifications = await Notification.deleteMany({
      $or: [{ user: userId }, { actor: userId }],
    });
    console.log(
      `🔔 [DELETE] Deleted ${deletedNotifications.deletedCount} notifications`
    );

    const Conversation = require("../models/Conversation");
    const Message = require("../models/Message");

    const conversations = await Conversation.find({
      participants: userId,
    });
    const conversationIds = conversations.map((c) => c._id);

    const deletedMessages = await Message.deleteMany({
      conversation: { $in: conversationIds },
    });
    console.log(`✉️ [DELETE] Deleted ${deletedMessages.deletedCount} messages`);

    const deletedConversations = await Conversation.deleteMany({
      participants: userId,
    });
    console.log(
      `💌 [DELETE] Deleted ${deletedConversations.deletedCount} conversations`
    );

    const followRemoval = await User.updateMany(
      { $or: [{ followers: userId }, { following: userId }] },
      { $pull: { followers: userId, following: userId } }
    );
    console.log(
      `👥 [DELETE] Updated ${followRemoval.modifiedCount} users' follow lists`
    );

    const followRequestRemoval = await User.updateMany(
      { "followRequests.user": userId },
      { $pull: { followRequests: { user: userId } } }
    );
    console.log(
      `📮 [DELETE] Removed ${followRequestRemoval.modifiedCount} follow requests`
    );

    await User.findByIdAndDelete(userId);
    console.log(`✅ [DELETE] User account deleted: ${username}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"); // ✅ [FIX] Also clear the cookie here

    res.clearCookie("refreshToken", getCookieOptions());

    res.json({
      ok: true,
      message: "Account and all associated data deleted successfully",
    });
  } catch (e) {
    console.error("❌ [DELETE ACCOUNT ERROR]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Facebook OAuth (client-side token exchange) ---
// Expects { accessToken } from the Facebook JS SDK (client-side).
// Server validates the token with Facebook, fetches basic profile info,
// then finds or creates a local user and issues our JWT tokens.
router.post("/facebook", async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken)
      return res.status(400).json({ error: "Missing accessToken" });

    const FB_APP_ID = process.env.FB_APP_ID || "733259775786990";
    const FB_APP_SECRET =
      process.env.FB_APP_SECRET || "388d2afac7ec338882f03c979fc91815";

    // 1) Validate token using debug_token with App Access Token
    const appAccessToken = `${FB_APP_ID}|${FB_APP_SECRET}`;
    const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(
      accessToken
    )}&access_token=${encodeURIComponent(appAccessToken)}`;

    const fetchFn = global.fetch || require("node-fetch");
    const debugResp = await fetchFn(debugUrl).then((r) => r.json());

    if (!debugResp || !debugResp.data || !debugResp.data.is_valid) {
      return res.status(401).json({ error: "Invalid Facebook token" });
    }

    // Ensure token was issued for our app
    if (String(debugResp.data.app_id) !== String(FB_APP_ID)) {
      return res.status(401).json({ error: "Facebook token app mismatch" });
    }

    const fbUserId = debugResp.data.user_id;

    // 2) Fetch user profile from Graph API
    const profileUrl = `https://graph.facebook.com/${fbUserId}?fields=id,name,email,picture.width(400).height(400)&access_token=${encodeURIComponent(
      accessToken
    )}`;
    const profile = await fetchFn(profileUrl).then((r) => r.json());

    if (!profile || !profile.id) {
      return res
        .status(500)
        .json({ error: "Failed to fetch Facebook profile" });
    }

    // 3) Find or create user
    let user = await User.findOne({
      $or: [{ facebookId: profile.id }, { email: profile.email }],
    });

    if (!user) {
      // create unique username from name
      const base =
        (profile.name || "user")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 12) || `fbuser${Math.floor(Math.random() * 10000)}`;
      let username = base;
      let i = 0;
      while (await User.findOne({ username })) {
        i += 1;
        username = `${base}${i}`;
      }

      const randomPassword = crypto.randomBytes(16).toString("hex");
      const hash = await bcrypt.hash(randomPassword, 10);

      user = await User.create({
        username,
        email: profile.email || `fb-${profile.id}@facebook.local`,
        passwordHash: hash,
        name: profile.name,
        profilePic: profile.picture?.data?.url,
        verified: true,
        facebookId: profile.id,
        providerData: { facebook: profile },
      });
    } else {
      // ensure facebookId is set
      if (!user.facebookId) user.facebookId = profile.id;
      // update profile pic/name if missing
      if (!user.profilePic && profile.picture?.data?.url)
        user.profilePic = profile.picture.data.url;
      if (!user.name && profile.name) user.name = profile.name;
      user.providerData = Object.assign({}, user.providerData || {}, {
        facebook: profile,
      });
      await user.save();
    }

    // 4) Issue our tokens (access + refresh) and set refresh cookie
    const access = signAccess(user);
    const refresh = signRefresh(user);

    user.refreshTokens = user.refreshTokens || [];
    user.refreshTokens.push({ tokenHash: refresh, createdAt: new Date() });
    await user.save();

    res.cookie("refreshToken", refresh, getCookieOptions());

    return res.json({
      access,
      user: {
        id: user._id,
        _id: user._id,
        username: user.username,
        name: user.name,
        profilePic: user.profilePic,
        bio: user.bio,
        isPrivate: user.isPrivate,
        followersCount: user.followers ? user.followers.length : 0,
        followingCount: user.following ? user.following.length : 0,
        followers: user.followers || [],
        following: user.following || [],
        followRequests: user.followRequests || [],
      },
    });
  } catch (e) {
    console.error("/auth/facebook error", e);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
