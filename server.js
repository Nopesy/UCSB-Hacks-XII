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

/**
 * Infer event type from title and description using keyword matching
 * @param {string} title - Event title
 * @param {string} description - Event description
 * @returns {string} - Inferred event type
 */
function inferEventType(title, description = '') {
  const text = `${title} ${description}`.toLowerCase()

  // Meeting patterns (check first - most specific)
  if (/\bmeeting\b|1[:\-]1|one[:\-]on[:\-]one|\bsync\b|\bstandup\b|\bcheck[- ]?in\b|\bretro\b|\bweekly\b.*\bwith\b|\bscott\b|\banna\b/i.test(text)) {
    return 'meeting'
  }

  // Meal patterns
  if (/\blunch\b|\bdinner\b|\bbreakfast\b|\bmeal\b|\beat(ing)?\b|\bfood\b|\bcoffee\b|\bbrunch\b/i.test(text)) {
    return 'meal'
  }

  // Exam/test patterns (high priority)
  if (/\bexam\b|\btest\b|\bquiz\b|\bmidterm\b|\bfinal\b|\bassessment\b/i.test(text)) {
    return 'exam'
  }

  // Assignment patterns
  if (/\bassignment\b|\bhomework\b|\bdue\b|\bsubmit\b|\bproject\b|\bpaper\b|\bessay\b|\blab\b.*\breport\b/i.test(text)) {
    return 'assignment'
  }

  // Nap/rest patterns
  if (/\bnap\b|\brest\b|\bpower nap\b|\bsleep\b/i.test(text)) {
    return 'nap'
  }

  // Exercise patterns
  if (/\bworkout\b|\bgym\b|\bexercise\b|\byoga\b|\brun(ning)?\b|\bfitness\b|\bsport\b|\bswim\b|\bbike\b|\bhike\b/i.test(text)) {
    return 'exercise'
  }

  // Social patterns
  if (/\bparty\b|\bhangout\b|\bsocial\b|\bfriend\b|\bgathering\b|\bevent\b|\bcelebrat/i.test(text)) {
    return 'social'
  }

  // Class patterns (course codes, lecture, etc.)
  if (/\b[a-z]{2,4}\s*\d{2,3}[a-z]?\b|\blecture\b|\bclass\b|\bsection\b|\bseminar\b|\blab\b|\brecitation\b|\bcourse\b/i.test(text)) {
    return 'class'
  }

  // Default to generic event
  return 'event'
}

const port = process.env.PORT || 3001
app.listen(port, () => console.log(`🚀 API running on http://localhost:${port}`))


const DEMO_USER_ID = "default_user"

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

// POST /api/events - create a single event
app.post('/api/events', async (req, res) => {
  try {
    const { userId = DEMO_USER_ID, calendarId, title, description, startTs, endTs, type } = req.body

    if (!title || !startTs || !endTs) {
      return res.status(400).json({ error: 'title, startTs, and endTs are required' })
    }

    // Use provided type or infer from title/description
    const eventType = type || inferEventType(title, description || '')

    const newEvent = new CalendarEvent({
      userId,
      calendarId: calendarId || 'ai-recommendations',
      googleId: `ai-${Date.now()}-${Math.random()}`,
      title,
      description: description || '',
      startTs: new Date(startTs),
      endTs: new Date(endTs),
      type: eventType,
    })

    await newEvent.save()

    res.status(201).json({ success: true, event: newEvent })
  } catch (error) {
    console.error('Error creating event:', error)
    res.status(500).json({ error: 'Failed to create event' })
  }
})

// PATCH /api/events/:eventId/status - toggle event status between malleable and fixed
app.patch('/api/events/:eventId/status', async (req, res) => {
  try {
    const { eventId } = req.params
    const { status } = req.body

    if (!status || !['malleable', 'fixed'].includes(status)) {
      return res.status(400).json({ error: 'status must be either "malleable" or "fixed"' })
    }

    const event = await CalendarEvent.findByIdAndUpdate(
      eventId,
      { status },
      { new: true }
    )

    if (!event) {
      return res.status(404).json({ error: 'Event not found' })
    }

    res.json({ success: true, event })
  } catch (error) {
    console.error('Error updating event status:', error)
    res.status(500).json({ error: 'Failed to update event status' })
  }
})

// DELETE /api/events/clear-all - delete all events (dev only)
app.delete('/api/events/clear-all', async (req, res) => {
  try {
    const result = await CalendarEvent.deleteMany({})
    const ratingsResult = await EventRating.deleteMany({})
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} events and ${ratingsResult.deletedCount} ratings`
    })
  } catch (error) {
    console.error('Error clearing events:', error)
    res.status(500).json({ error: 'Failed to clear events' })
  }
})

// DELETE /api/events/:eventId - delete an event
app.delete('/api/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: `Invalid event ID format: ${eventId}` })
    }

    const event = await CalendarEvent.findByIdAndDelete(eventId)

    if (!event) {
      return res.status(404).json({ error: 'Event not found' })
    }

    res.json({ success: true, message: 'Event deleted' })
  } catch (error) {
    console.error('Error deleting event:', error)
    res.status(500).json({ error: 'Failed to delete event' })
  }
})

// PATCH /api/events/:eventId/type - update event type
app.patch('/api/events/:eventId/type', async (req, res) => {
  try {
    const { eventId } = req.params
    const { type } = req.body

    console.log('PATCH /api/events/:eventId/type', { eventId, type })

    if (!type) {
      return res.status(400).json({ error: 'type is required' })
    }

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ error: `Invalid event ID format: ${eventId}` })
    }

    const event = await CalendarEvent.findByIdAndUpdate(
      eventId,
      { type },
      { new: true }
    )

    if (!event) {
      return res.status(404).json({ error: 'Event not found' })
    }

    console.log('Event type updated successfully:', event._id, event.type)
    res.json({ success: true, event })
  } catch (error) {
    console.error('Error updating event type:', error)
    res.status(500).json({ error: 'Failed to update event type', details: error.message })
  }
})

// PATCH /api/events/:eventId - update event times (for schedule optimization)
app.patch('/api/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params
    const { startTs, endTs } = req.body

    console.log('PATCH /api/events/:eventId', { eventId, startTs, endTs })

    // Validate that eventId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      console.log('Invalid ObjectId format:', eventId)
      return res.status(400).json({ error: `Invalid event ID format: ${eventId}` })
    }

    if (!startTs || !endTs) {
      return res.status(400).json({ error: 'startTs and endTs are required' })
    }

    const newStart = new Date(startTs)
    const newEnd = new Date(endTs)

    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      return res.status(400).json({ error: 'Invalid date format for startTs or endTs' })
    }

    if (newEnd <= newStart) {
      return res.status(400).json({ error: 'endTs must be after startTs' })
    }

    // Find the event first to get its userId
    const existingEvent = await CalendarEvent.findById(eventId)
    if (!existingEvent) {
      return res.status(404).json({ error: 'Event not found' })
    }

    // Check for conflicts with fixed events (excluding the event being moved)
    const conflicts = await CalendarEvent.find({
      userId: existingEvent.userId,
      _id: { $ne: eventId },
      status: 'fixed',
      $or: [
        // New event starts during an existing event
        { startTs: { $lte: newStart }, endTs: { $gt: newStart } },
        // New event ends during an existing event
        { startTs: { $lt: newEnd }, endTs: { $gte: newEnd } },
        // New event completely contains an existing event
        { startTs: { $gte: newStart }, endTs: { $lte: newEnd } }
      ]
    })

    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'Time conflict with fixed event(s)',
        conflicts: conflicts.map(c => ({
          id: c._id,
          title: c.title,
          startTs: c.startTs,
          endTs: c.endTs
        }))
      })
    }

    // Update the event
    const event = await CalendarEvent.findByIdAndUpdate(
      eventId,
      {
        startTs: newStart,
        endTs: newEnd,
        startISO: newStart.toISOString(),
        endISO: newEnd.toISOString()
      },
      { new: true }
    )

    res.json({ success: true, event })
  } catch (error) {
    console.error('Error updating event:', error)
    // Check if it's a CastError (invalid ObjectId format)
    if (error.name === 'CastError') {
      return res.status(400).json({ error: `Invalid event ID format: ${error.value}` })
    }
    res.status(500).json({ error: 'Failed to update event', details: error.message })
  }
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

      // Infer event type from title/description
      const type = inferEventType(title, description)

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
              type,
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

// POST /api/events/reclassify - re-classify all events with inferred types
app.post('/api/events/reclassify', async (req, res) => {
  try {
    const { user_id: userId = DEMO_USER_ID } = req.body

    // Find all events for this user
    const events = await CalendarEvent.find({ userId })

    let updated = 0
    for (const event of events) {
      const newType = inferEventType(event.title || '', event.description || '')
      if (event.type !== newType) {
        event.type = newType
        await event.save()
        updated++
      }
    }

    return res.json({
      success: true,
      total: events.length,
      updated,
      message: `Re-classified ${updated} of ${events.length} events`
    })
  } catch (err) {
    console.error('POST /api/events/reclassify error:', err)
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
