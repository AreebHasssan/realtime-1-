const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const user = require("../../model/auth/auth");
const register = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const exitinguser = await user.findOne({ email: email });
    if (exitinguser) {
      return res.status(400).json({
        message: "This email already exists",
      });
    }
    const hashedpassword = await bcrypt.hash(password, 10);
    const newuser = await user.create({
      name: name,
      email: email,
      password: hashedpassword,
    });

    const token = jwt.sign(
      {
        id: newuser._id,
        name: newuser.name,
        email: newuser.email,
      },
      process.env.JWT_SECRET || "CLIENT_SECRET_KEY",
      { expiresIn: "4h" },
    );

    const safeUser = {
      id: newuser._id,
      name: newuser.name,
      email: newuser.email,
    };

    const isProduction = process.env.NODE_ENV === "production";

    res
      .status(201)
      .cookie("token", token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 4 * 60 * 60 * 1000,
      })
      .json({
        success: true,
        message: "User registered successfully",
        token,
        user: safeUser,
      });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const exitinguser = await user.findOne({ email: email });
    if (!exitinguser) {
      return res.status(400).json({
        message: "The user with this email does not exist",
      });
    }
    const matchpassword = await bcrypt.compare(password, exitinguser.password);

    if (!matchpassword) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign(
      {
        id: exitinguser._id,
        name: exitinguser.name,
        email: exitinguser.email,
      },
      process.env.JWT_SECRET || "CLIENT_SECRET_KEY",
      { expiresIn: "4h" },
    );
    const isProduction = process.env.NODE_ENV === "production";

    return res
      .status(200)
      .cookie("token", token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 4 * 60 * 60 * 1000,
      })
      .json({
        success: true,
        message: "Logged in successfully",
        token,
        user: {
          id: exitinguser._id,
          name: exitinguser.name,
          email: exitinguser.email,
        },
      });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Server error during login",
    });
  }
};

const logoutUser = (req, res) => {
  const isProduction = process.env.NODE_ENV === "production";

  res
    .clearCookie("token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
    })
    .json({
      success: true,
      message: "Logged out successfully",
    });
};

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  let token = authHeader.replace("Bearer ", "");

  if (!token && req.cookies) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized user",
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "CLIENT_SECRET_KEY",
    );
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized user",
    });
  }
};


module.exports = {
  logoutUser,
  authMiddleware,
  register,
  login,
};