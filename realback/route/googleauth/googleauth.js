const express = require("express");
const router = express.Router();
const { passport, googleCallbackController, verifyAuthController } = require("../../controllers/googleauth/googleauth");
const { authMiddleware } = require("../../controllers/auth/auth");

router.use(passport.initialize());

router.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/auth/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "http://localhost:3000/auth" }),
  googleCallbackController
);

router.get("/auth/verify", authMiddleware, (req, res) => {
  res.status(200).json({ isAuthenticated: true, user: req.user });
});

router.get("/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.status(200).json({ message: "Logged out successfully" });
});

module.exports = router;