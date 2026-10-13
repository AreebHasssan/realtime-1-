const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    googleId: String,
    displayName: String,
    email: String,
    image: String
}, { timestamps: true });

const userdb = mongoose.model("User", userSchema);

module.exports = userdb;