// routes/auth.js (Fixed Version)

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// --- Helper Functions ---

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
 * ✅ [FIXED] Generates cookie options based on the environment.
 * In development (HTTP), we must use 'lax' to allow the cookie to be set.
 * In production (HTTPS), we must use 'none' and 'secure' for cross-domain cookies.
 */
const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true, // Cannot be accessed by client-side JS
    secure: isProduction, // Only send over HTTPS in production
    sameSite: isProduction ? "none" : "lax", // 'none' for cross-domain prod, 'lax' for dev
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/", // Available to entire app
  };
};

// --- Route Handlers ---

const register = async (req, res) => {
  try {
    const { username, email, password, name } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: "Missing fields" });

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ error: "User exists" });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      passwordHash: hash,
      name,
      followers: [],
      following: [],
      followRequests: [],
    });

    const access = signAccess(user);
    const refresh = signRefresh(user); // store refresh token

    user.refreshTokens.push({ tokenHash: refresh, createdAt: new Date() });
    await user.save(); // ✅ [FIXED] Use the new dynamic cookie options

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
        followers: user.followers ? user.followers : [],
        following: user.following ? user.following : [],
        followRequests: user.followRequests ? user.followRequests : [],
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
};

const login = async (req, res) => {
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

    const access = signAccess(user);
    const refresh = signRefresh(user);

    user.refreshTokens.push({ tokenHash: refresh, createdAt: new Date() });
    await user.save(); // ✅ [FIXED] Use the new dynamic cookie options

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
        followers: user.followers ? user.followers : [],
        following: user.following ? user.following : [],
        followRequests: user.followRequests ? user.followRequests : [],
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
};

const refresh = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({ error: "No refresh token" });
    }

    const payload = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || "refresh-secret"
    );

    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    } // Check if token is in the database

    const found = user.refreshTokens.find((r) => r.tokenHash === token);
    if (!found) {
      return res.status(401).json({ error: "Refresh token not recognized" });
    } // --- Token Rotation ---

    const access = signAccess(user);
    const newRefresh = signRefresh(user); // Remove old token, add new token

    user.refreshTokens = user.refreshTokens.filter(
      (r) => r.tokenHash !== token
    );
    user.refreshTokens.push({ tokenHash: newRefresh, createdAt: new Date() });
    await user.save(); // ✅ [FIXED] Use the new dynamic cookie options

    res.cookie("refreshToken", newRefresh, getCookieOptions());

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
        followers: user.followers ? user.followers : [],
        following: user.following ? user.following : [],
        followRequests: user.followRequests ? user.followRequests : [],
      },
    });
  } catch (e) {
    console.warn("refresh error", e);
    return res.status(401).json({ error: "Invalid refresh" });
  }
};

const logout = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (token) {
      try {
        // We don't strictly need to verify, just find and remove
        // But verifying finds the user, which is cleaner
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
        // ignore token verification errors (e.g., expired)
      }
    } // ✅ [FIXED] Clear the cookie using the *exact same* options it was set with

    const cookieOptions = getCookieOptions(); // To clear a cookie, you set maxAge to a past or zero value
    res.clearCookie("refreshToken", {
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      path: cookieOptions.path,
    }); // As a fallback, also send an expired cookie (some browsers prefer this)

    res.cookie("refreshToken", "", { ...getCookieOptions(), maxAge: 0 });

    return res.json({ ok: true, message: "Logged out successfully" });
  } catch (e) {
    console.warn("❌ [LOGOUT] Logout error:", e);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = { register, login, refresh, logout };
