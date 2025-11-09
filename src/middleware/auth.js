const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  try {
    const auth = req.headers && req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Missing authorization" });
    const parts = String(auth).split(" ");
    if (parts.length !== 2)
      return res.status(401).json({ error: "Invalid authorization" });
    const scheme = parts[0];
    const token = parts[1];
    if (!/^Bearer$/i.test(scheme))
      return res.status(401).json({ error: "Invalid authorization scheme" });
    if (!token || token === "null" || token === "undefined")
      return res.status(401).json({ error: "Missing token" });
    // quick shape check to avoid calling jwt.verify on clearly invalid values
    // a JWT access token should have three dot-separated parts
    if (typeof token !== "string" || token.split(".").length !== 3) {
      // only verbose in non-production to avoid log noise
      if (process.env.NODE_ENV !== "production") {
        console.debug("auth middleware: rejected malformed token (bad shape)", {
          tokenPreview: String(token).slice(0, 60),
          path: req.path,
          method: req.method,
        });
      }
      return res.status(401).json({ error: "Invalid token" });
    }

    let payload;
    try {
      payload = jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET || "access-secret"
      );
    } catch (err) {
      // don't print the full stack for expected jwt errors; show only the message in dev
      if (process.env.NODE_ENV !== "production") {
        console.debug(
          "auth middleware JsonWebTokenError:",
          err && err.message ? err.message : err
        );
      }
      return res.status(401).json({ error: "Invalid token" });
    }
    const user = await User.findById(payload.sub).select(
      "-passwordHash -refreshTokens"
    );
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user = user;
    next();
  } catch (e) {
    console.warn("auth middleware", e);
    return res.status(401).json({ error: "Unauthorized" });
  }
};

module.exports = authMiddleware;
