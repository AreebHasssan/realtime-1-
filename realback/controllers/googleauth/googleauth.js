require("dotenv").config();
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const User = require("../../model/googleauth/googleauth");

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const rawBackend = process.env.BACKEND_URL || "http://localhost:8000";
    const cleanBackend = rawBackend.replace(/\/+$/, "");

    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${cleanBackend}/api/auth/google/callback`,
          proxy: true,
        },
      async (accessToken, refreshToken, profile, done) => {
        try {
          let user = await User.findOne({ googleId: profile.id });

          if (!user) {
            user = await User.create({
              googleId: profile.id,
              displayName: profile.displayName,
              email: profile.emails && profile.emails[0] ? profile.emails[0].value : "",
              image: profile.photos && profile.photos[0] ? profile.photos[0].value : "",
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
} else {
  console.warn("Google OAuth credentials missing in .env");
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const googleCallbackController = (req, res) => {
  const frontend = process.env.FRONTEND_URL || "http://localhost:3000";
  if (!req.user) {
    return res.redirect(`${frontend}/auth`);
  }

  const payload = {
    id: req.user._id,
    email: req.user.email,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET || "default_secret", {
    expiresIn: "7d",
  });

  const isProduction = process.env.NODE_ENV === "production";

  res.cookie("token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.redirect(`${frontend}/dashboard`);
};

const verifyAuthController = (req, res) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ isAuthenticated: false });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_secret");
    return res.status(200).json({ isAuthenticated: true, user: decoded });
  } catch (err) {
    return res.status(401).json({ isAuthenticated: false });
  }
};

module.exports = {
  passport,
  googleCallbackController,
  verifyAuthController,
};