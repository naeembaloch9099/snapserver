require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const path = require("path");

// Optionally disable console output on the server when DISABLE_CONSOLE is set
try {
  if (process.env.DISABLE_CONSOLE === "true") {
    ["log", "info", "warn", "error", "debug"].forEach((m) => {
      try {
        global.__origConsole = global.__origConsole || {};
        global.__origConsole[m] = console[m];
      } catch (e) {
        // ignore
      }
      console[m] = () => {};
    });
  }
} catch (e) {
  // ignore
}

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users2");
const postRoutes = require("./routes/posts");
const messageRoutes = require("./routes/messages");
const notificationRoutes = require("./routes/notifications");
const legalRoutes = require("./routes/legal");
const { initSockets } = require("./sockets");

const PORT = process.env.PORT || 4000;
const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";

const app = express();
const server = http.createServer(app);

// CORS origin configuration - allow a whitelist and also common localhost dev origins.
// This uses a dynamic origin check so requests from your local dev server
// (e.g. http://localhost:5173) will be accepted even when this server runs
// with FRONTEND_ORIGIN set to your deployed Vercel URL.
const parseEnvOrigins = () => {
  // Support comma-separated list in FRONTEND_ORIGINS or single FRONTEND_ORIGIN
  const raw = process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const defaultLocalOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const whitelist = [...defaultLocalOrigins, ...parseEnvOrigins()];

const originIsAllowed = (origin) => {
  if (!origin) return true; // allow non-browser requests (curl, server-to-server)
  return whitelist.some((w) => {
    if (w instanceof RegExp) return w.test(origin);
    return w === origin;
  });
};

const corsOptions = {
  origin: (origin, callback) => {
    if (originIsAllowed(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

const io = new Server(server, {
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Serve uploaded media files statically from /uploads
const uploadsPath = path.join(__dirname, "..", "uploads");
app.use("/uploads", express.static(uploadsPath));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/legal", legalRoutes);

// basic health
app.get("/api/health", (req, res) => res.json({ ok: true }));

mongoose
  .connect(MONGO)
  .then(() => {
    console.log("Connected to MongoDB");
    server.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
    initSockets(io);
  })
  .catch((err) => {
    console.error("MongoDB connection failed", err);
    process.exit(1);
  });
