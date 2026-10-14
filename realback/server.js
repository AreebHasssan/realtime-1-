require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const setupSocket = require("./sockets/wrtc");
const authRoutes = require("./route/auth/auth");
const googleAuthRoutes = require("./route/googleauth/googleauth");
const meetingRoutes = require("./route/meeting/meeting");

const app = express();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
if (process.env.DB_URL) {
  mongoose
    .connect(process.env.DB_URL)
    .then(() => console.log("MongoDB connected successfully"))
    .catch((err) => console.error("MongoDB connection error:", err.message));
}

// Routes
app.get("/", (req, res) => {
  res.status(200).json({ status: "online", message: "RealTime Backend API is running" });
});
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});
app.use("/api/auth", authRoutes);
app.use("/api", googleAuthRoutes);
app.use("/api/meetings", meetingRoutes);

const http = require("http");
const server = http.createServer(app);

const allowedOrigins = [
  frontendUrl,
  frontendUrl.replace(/\/$/, ""),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow any origin in dev or if origin is in allowedOrigins
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

setupSocket(io);

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server and WebSockets running on port ${PORT}`);
});

