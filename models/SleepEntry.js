import mongoose from "mongoose"

const SleepEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true, index: true }, // YYYY-MM-DD
    sleepTime: { type: String, required: true }, // HH:MM
    wakeTime: { type: String, required: true },  // HH:MM
    timezone: { type: String, default: "America/Los_Angeles" },
  },
  { timestamps: true }
)

// Only one sleep entry per user per day
SleepEntrySchema.index({ userId: 1, dateKey: 1 }, { unique: true })

export default mongoose.model("SleepEntry", SleepEntrySchema)
