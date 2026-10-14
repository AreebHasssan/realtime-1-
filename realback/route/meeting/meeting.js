const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Meeting = require("../../model/meeting/meeting");
const { authMiddleware } = require("../../controllers/auth/auth");

const optionalAuth = (req, res, next) => {
  const token =
    (req.cookies && req.cookies.token) ||
    (req.headers.authorization || "").replace("Bearer ", "");
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || "CLIENT_SECRET_KEY");
    } catch {}
  }
  next();
};

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Meeting name is required" });
    }

    const roomId = Math.random().toString(36).substring(2, 8);
    const meeting = await Meeting.create({
      roomId,
      name: name.trim(),
      creatorEmail: req.user.email,
      creatorName: req.user.name || "",
    });

    res.status(201).json({ success: true, meeting });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/", authMiddleware, async (req, res) => {
  try {
    const meetings = await Meeting.find({ creatorEmail: req.user.email }).sort({ createdAt: -1 });
    res.json({ success: true, meetings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:roomId", optionalAuth, async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });
    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }
    const isAdmin = Boolean(req.user && req.user.email === meeting.creatorEmail);
    res.json({ success: true, meeting, isAdmin });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:roomId", authMiddleware, async (req, res) => {
  try {
    await Meeting.findOneAndDelete({
      roomId: req.params.roomId,
      creatorEmail: req.user.email,
    });
    res.json({ success: true, message: "Meeting deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
