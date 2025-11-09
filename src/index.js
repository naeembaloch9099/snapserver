require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const path = require("path");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users2");
const postRoutes = require("./routes/posts");
const messageRoutes = require("./routes/messages");
const notificationRoutes = require("./routes/notifications");
const { initSockets } = require("./sockets");

const PORT = process.env.PORT || 4000;
const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/snapgram";

const app = express();
const server = http.createServer(app);

// CORS origin configuration - support localhost, local network IPs, and production
const getAllowedOrigins = () => {
  const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

  // In development, allow localhost and local network access
  if (process.env.NODE_ENV !== "production") {
    return [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3000",
      /^http:\/\/192\.168\.\d+\.\d+:5173$/, // Allow any 192.168.x.x with port 5173
      /^http:\/\/192\.168\.\d+\.\d+:3000$/, // Allow any 192.168.x.x with port 3000
      /^http:\/\/10\.\d+\.\d+\.\d+:5173$/, // Allow any 10.x.x.x with port 5173
      /^http:\/\/10\.\d+\.\d+\.\d+:3000$/, // Allow any 10.x.x.x with port 3000
      frontendOrigin,
    ];
  }

  // Production - use specific origin
  return frontendOrigin;
};

const corsOptions = {
  origin: getAllowedOrigins(),
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
