import mongoose from 'mongoose'
const { Schema } = mongoose

const CalendarEventSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    googleId: { type: String, required: true },
    calendarId: { type: String, required: true },
    title: { type: String },
    description: { type: String },
    location: { type: String },
    startISO: { type: String },
    endISO: { type: String },
    startTs: { type: Date, index: true },
    endTs: { type: Date, index: true },
    raw: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['malleable', 'fixed'], default: 'fixed' },
    type: {
      type: String,
      enum: ['class', 'meeting', 'meal', 'exam', 'assignment', 'nap', 'exercise', 'social', 'event'],
      default: 'event'
    },
  },
  { timestamps: true }
)

// ensure uniqueness per user + google event id
CalendarEventSchema.index({ userId: 1, googleId: 1 }, { unique: true })

export default mongoose.model('CalendarEvent', CalendarEventSchema)
