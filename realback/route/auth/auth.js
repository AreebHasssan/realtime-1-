const express = require("express");
const router = express.Router();
const {
  register,
  login,
  logoutUser,
  authMiddleware,
} = require("../../controllers/auth/auth");

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logoutUser);

router.get("/check-auth", authMiddleware, async (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
});

module.exports = router;