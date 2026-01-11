import mongoose from 'mongoose'
const { Schema } = mongoose

const EventRatingSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    eventId: { type: String, required: true }, // googleId from CalendarEvent
    calendarId: { type: String },
    eventTitle: { type: String },
    eventStartTime: { type: Date },
    happinessRating: { type: Number, min: 1, max: 10, required: true },
    tirednessRating: { type: Number, min: 1, max: 10, required: true },
    journalEntry: { type: String, default: '' },
  },
  { timestamps: true }
)

// Ensure one rating per user per event
EventRatingSchema.index({ userId: 1, eventId: 1 }, { unique: true })

export default mongoose.model('EventRating', EventRatingSchema)
