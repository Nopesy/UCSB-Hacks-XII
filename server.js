import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import mongoose from "mongoose"

import SleepEntry from "./models/SleepEntry.js"


dotenv.config() //loads .env file contents into process.env

const app = express() //creates api server 
app.use(cors())//alows requests from localhost:5173 (frontend)
app.use(express.json()) //lets us read json in request body

// connects to Mongo
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err)
    process.exit(1)
  })

// checks if server is running
app.get("/api/health", (req, res) => res.json({ ok: true }))

const port = process.env.PORT || 3001
app.listen(port, () => console.log(`🚀 API running on http://localhost:${port}`))


const DEMO_USER_ID = "demo-user"

function todayDateKeyLA() {//get todays date in y/m/d format in LA timezone
  const now = new Date()
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)

  const y = parts.find(p => p.type === "year")?.value
  const m = parts.find(p => p.type === "month")?.value
  const d = parts.find(p => p.type === "day")?.value
  return `${y}-${m}-${d}`
}


app.get("/api/sleep/today", async (req, res) => { //checks for sleep entry for today
  const dateKey = todayDateKeyLA()

  const entry = await SleepEntry.findOne({
    userId: DEMO_USER_ID,
    dateKey,
  }).lean()

  if (!entry) {
    return res.status(404).json({ message: "No sleep entry for today" })
  }

  res.json({
    sleepTime: entry.sleepTime,
    wakeTime: entry.wakeTime,
    dateKey: entry.dateKey,
  })
})

app.post("/api/sleep", async (req, res) => {//creates or updates sleep entry for today
  const { sleepTime, wakeTime } = req.body

  if (!sleepTime || !wakeTime) {
    return res.status(400).json({ message: "sleepTime and wakeTime required" })
  }

  const dateKey = todayDateKeyLA()

  const saved = await SleepEntry.findOneAndUpdate(
    { userId: DEMO_USER_ID, dateKey },
    { $set: { sleepTime, wakeTime } },
    { upsert: true, new: true }
  ).lean()

  res.json({
    sleepTime: saved.sleepTime,
    wakeTime: saved.wakeTime,
    dateKey: saved.dateKey,
  })
})
