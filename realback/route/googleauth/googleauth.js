const express = require("express");
const router = express.Router();
const { passport, googleCallbackController, verifyAuthController } = require("../../controllers/googleauth/googleauth");
const { authMiddleware } = require("../../controllers/auth/auth");

router.use(passport.initialize());

router.get(
  "/auth/google",
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).send("Google OAuth is not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your backend environment variables.");
    }
    passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
  }
);

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

router.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.redirect(`${frontendUrl}/auth?error=google_not_configured`);
    }
    passport.authenticate("google", { session: false, failureRedirect: `${frontendUrl}/auth` })(req, res, next);
  },
  googleCallbackController
);

router.get("/auth/verify", authMiddleware, (req, res) => {
  res.status(200).json({ isAuthenticated: true, user: req.user });
});

router.get("/auth/logout", (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
  });
  res.status(200).json({ message: "Logged out successfully" });
});

module.exports = router;