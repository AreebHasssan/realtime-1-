const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    creatorEmail: {
      type: String,
      required: true,
    },
    creatorName: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Meeting || mongoose.model("Meeting", meetingSchema);
