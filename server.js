// GET /api/sleep/:date?user_id=... - fetch sleep entry for a specific date and user
app.get("/api/sleep/:date", async (req, res) => {
  const { date } = req.params;
  const userId = req.query.user_id || DEMO_USER_ID;
  if (!date) {
    return res.status(400).json({ message: "date param required (YYYY-MM-DD)" });
  }
  const entry = await SleepEntry.findOne({
    userId,
    dateKey: date,
  }).lean();
  if (!entry) {
    return res.status(404).json({ message: "No sleep entry for this date" });
  }
  res.json({
    sleepTime: entry.sleepTime,
    wakeTime: entry.wakeTime,
    dateKey: entry.dateKey,
  });
});
import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import mongoose from "mongoose"

import SleepEntry from "./models/SleepEntry.js"
import CalendarEvent from "./models/CalendarEvent.js"
import EventRating from "./models/EventRating.js"


dotenv.config() //loads .env file contents into process.env

const app = express() //creates api server 
app.use(cors())//alows requests from localhost:5173 (frontend)
// Increase body parsing limits to accept large calendar sync payloads
app.use(express.json({ limit: '20mb' })) //lets us read large json in request body
app.use(express.urlencoded({ limit: '20mb', extended: true }))

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

// POST /api/events/sync - accept events from calendar-agent and upsert to MongoDB
app.post('/api/events/sync', async (req, res) => {
  try {
    const { user_id: userId = DEMO_USER_ID, events = [] } = req.body
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' })

    const ops = events.map((ev) => {
      const googleId = ev.id || ev.googleId
      const calendarId = ev.calendar_id || ev.calendarId || ''
      const title = ev.title || ev.summary || ''
      const description = ev.description || ''
      const location = ev.location || ''

      // Google events can have different shapes for start/end:
      // - timed events: start.dateTime / end.dateTime
      // - all-day events: start.date / end.date
      // - or older/test payloads might include start/end as strings
      const startISO = ev.start?.dateTime || ev.start?.date || (typeof ev.start === 'string' ? ev.start : '') || ''
      const endISO = ev.end?.dateTime || ev.end?.date || (typeof ev.end === 'string' ? ev.end : '') || ''

      const startTs = startISO ? new Date(startISO) : null
      const endTs = endISO ? new Date(endISO) : null

      return {
        updateOne: {
          filter: { userId, googleId },
          update: {
            $set: {
              userId,
              googleId,
              calendarId,
              title,
              description,
              location,
              startISO,
              endISO,
              startTs,
              endTs,
              raw: ev,
            },
          },
          upsert: true,
        },
      }
    })

    if (ops.length === 0) return res.json({ success: true, inserted: 0, updated: 0 })

    const result = await CalendarEvent.bulkWrite(ops)

    return res.json({ success: true, bulkResult: result.result || result, nUpserted: result.nUpserted ?? result.upsertedCount ?? 0 })
  } catch (err) {
    console.error('POST /api/events/sync error:', err)
    return res.status(500).json({ error: err.message })
  }
})

// GET /api/events - query events (user_id required)
app.get('/api/events', async (req, res) => {
  try {
    const userId = req.query.user_id || DEMO_USER_ID
    const calendarId = req.query.calendarId
    const start = req.query.start
    const end = req.query.end
    const limit = Math.min(1000, parseInt(req.query.limit || '500', 10))
    const skip = parseInt(req.query.skip || '0', 10)

    const q = { userId }
    if (calendarId) q.calendarId = calendarId
    if (start || end) {
      q.$and = []
      if (start) q.$and.push({ endTs: { $gte: new Date(start) } })
      if (end) q.$and.push({ startTs: { $lte: new Date(end) } })
    }

    const events = await CalendarEvent.find(q).sort({ startTs: 1 }).skip(skip).limit(limit).lean()
    res.json({ events })
  } catch (err) {
    console.error('GET /api/events error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/calendars - list calendars per user with counts
app.get('/api/calendars', async (req, res) => {
  try {
    const userId = req.query.user_id || DEMO_USER_ID
    const agg = await CalendarEvent.aggregate([
      { $match: { userId } },
      { $group: { _id: '$calendarId', count: { $sum: 1 } } },
      { $project: { calendarId: '$_id', count: 1, _id: 0 } },
    ])
    res.json({ calendars: agg })
  } catch (err) {
    console.error('GET /api/calendars error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/events/unrated - get past events from last 3 days that haven't been rated
app.get('/api/events/unrated', async (req, res) => {
  try {
    const userId = req.query.user_id || DEMO_USER_ID
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const now = new Date()

    // Find events from last 3 days that have ended
    const pastEvents = await CalendarEvent.find({
      userId,
      endTs: { $gte: threeDaysAgo, $lte: now }
    }).sort({ endTs: -1 }).limit(20).lean()

    // Get all rated event IDs for this user
    const ratings = await EventRating.find({ userId }).select('eventId').lean()
    const ratedEventIds = new Set(ratings.map(r => r.eventId))

    // Filter out events that are already rated
    const unratedEvents = pastEvents.filter(e => !ratedEventIds.has(e.googleId))

    res.json({ events: unratedEvents })
  } catch (err) {
    console.error('GET /api/events/unrated error:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ratings - create or update an event rating
app.post('/api/ratings', async (req, res) => {
  try {
    const { user_id, event_id, calendar_id, event_title, event_start_time, happiness_rating, tiredness_rating, journal_entry } = req.body
    const userId = user_id || DEMO_USER_ID

    if (!event_id || happiness_rating == null || tiredness_rating == null) {
      return res.status(400).json({ error: 'event_id, happiness_rating, and tiredness_rating are required' })
    }

    const rating = await EventRating.findOneAndUpdate(
      { userId, eventId: event_id },
      {
        $set: {
          userId,
          eventId: event_id,
          calendarId: calendar_id || '',
          eventTitle: event_title || '',
          eventStartTime: event_start_time ? new Date(event_start_time) : null,
          happinessRating: happiness_rating,
          tirednessRating: tiredness_rating,
          journalEntry: journal_entry || '',
        }
      },
      { upsert: true, new: true }
    ).lean()

    res.json({ success: true, rating })
  } catch (err) {
    console.error('POST /api/ratings error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ratings - get ratings for a user
app.get('/api/ratings', async (req, res) => {
  try {
    const userId = req.query.user_id || DEMO_USER_ID
    const eventId = req.query.event_id

    const query = { userId }
    if (eventId) query.eventId = eventId

    const ratings = await EventRating.find(query).sort({ createdAt: -1 }).lean()
    res.json({ ratings })
  } catch (err) {
    console.error('GET /api/ratings error:', err)
    res.status(500).json({ error: err.message })
  }
})
