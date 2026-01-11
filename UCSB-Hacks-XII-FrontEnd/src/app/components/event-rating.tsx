import { useState, useEffect } from 'react'
import { Star, ChevronRight, Loader2 } from 'lucide-react'

interface CalendarEvent {
  _id: string
  googleId: string
  calendarId: string
  title: string
  startISO: string
  endISO: string
  startTs: string
  endTs: string
}

export function EventRating() {
  const [unratedEvents, setUnratedEvents] = useState<CalendarEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [happinessRating, setHappinessRating] = useState(5)
  const [tirednessRating, setTirednessRating] = useState(5)
  const [journalEntry, setJournalEntry] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const userId = 'default_user'

  useEffect(() => {
    loadUnratedEvents()
  }, [])

  async function loadUnratedEvents() {
    try {
      setLoading(true)
      const response = await fetch(`/api/events/unrated?user_id=${userId}`)
      const data = await response.json()
      setUnratedEvents(data.events || [])
    } catch (err) {
      console.error('Failed to load unrated events:', err)
    } finally {
      setLoading(false)
    }
  }

  async function submitRating() {
    if (!selectedEvent) return

    try {
      setSubmitting(true)
      const response = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          event_id: selectedEvent.googleId,
          calendar_id: selectedEvent.calendarId,
          event_title: selectedEvent.title,
          event_start_time: selectedEvent.startTs,
          happiness_rating: happinessRating,
          tiredness_rating: tirednessRating,
          journal_entry: journalEntry,
        }),
      })

      if (response.ok) {
        // Remove rated event from list
        setUnratedEvents(prev => prev.filter(e => e.googleId !== selectedEvent.googleId))
        // Reset form
        setSelectedEvent(null)
        setHappinessRating(5)
        setTirednessRating(5)
        setJournalEntry('')
      }
    } catch (err) {
      console.error('Failed to submit rating:', err)
    } finally {
      setSubmitting(false)
    }
  }

  function formatEventTime(startISO: string, endISO: string) {
    const start = new Date(startISO)
    const end = new Date(endISO)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    let dayLabel = ''
    if (start.toDateString() === today.toDateString()) {
      dayLabel = 'Today'
    } else if (start.toDateString() === yesterday.toDateString()) {
      dayLabel = 'Yesterday'
    } else {
      dayLabel = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }

    const timeRange = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    return `${dayLabel}, ${timeRange}`
  }

  if (loading) {
    return (
      <div className="bg-card rounded-lg p-6 shadow-sm border border-border">
        <h2 className="text-lg font-semibold mb-4">Rate Past Events</h2>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (unratedEvents.length === 0) {
    return (
      <div className="bg-card rounded-lg p-6 shadow-sm border border-border">
        <h2 className="text-lg font-semibold mb-4">Rate Past Events</h2>
        <p className="text-sm text-muted-foreground">No events from the last 3 days to rate.</p>
      </div>
    )
  }

  if (selectedEvent) {
    return (
      <div className="bg-card rounded-lg p-6 shadow-sm border border-border">
        <button
          onClick={() => setSelectedEvent(null)}
          className="text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          ← Back to events
        </button>

        <div className="mb-4">
          <h3 className="font-semibold text-foreground">{selectedEvent.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {formatEventTime(selectedEvent.startISO, selectedEvent.endISO)}
          </p>
        </div>

        <div className="space-y-6">
          {/* Happiness Rating */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-3">
              Happiness
            </label>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={happinessRating}
                  onChange={(e) => setHappinessRating(Number(e.target.value))}
                  className="flex-1 h-2 bg-gradient-to-r from-red-200 via-yellow-200 to-green-200 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{
                    background: `linear-gradient(to right, #fca5a5 0%, #fde047 50%, #86efac 100%)`
                  }}
                />
                <span className="text-2xl font-bold text-foreground w-10 text-center">
                  {happinessRating}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground px-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <span key={n} className="w-4 text-center">{n}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Tiredness Rating */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-3">
              Tiredness
            </label>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={tirednessRating}
                  onChange={(e) => setTirednessRating(Number(e.target.value))}
                  className="flex-1 h-2 bg-gradient-to-r from-green-200 via-yellow-200 to-red-200 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{
                    background: `linear-gradient(to right, #86efac 0%, #fde047 50%, #fca5a5 100%)`
                  }}
                />
                <span className="text-2xl font-bold text-foreground w-10 text-center">
                  {tirednessRating}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground px-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <span key={n} className="w-4 text-center">{n}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Journal Entry */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Notes (optional)
            </label>
            <textarea
              value={journalEntry}
              onChange={(e) => setJournalEntry(e.target.value)}
              placeholder="How did this event go? Any thoughts?"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
            />
          </div>

          <button
            onClick={submitRating}
            disabled={submitting}
            className="w-full bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {submitting ? 'Saving...' : 'Save Rating'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg p-6 shadow-sm border border-border">
      <h2 className="text-lg font-semibold mb-4 text-foreground">Rate Past Events</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Rate events from the last 3 days ({unratedEvents.length} remaining)
      </p>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {unratedEvents.map((event) => (
          <button
            key={event._id}
            onClick={() => setSelectedEvent(event)}
            className="w-full text-left p-3 bg-background hover:bg-muted rounded-md border border-border transition-colors group"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground truncate">
                  {event.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatEventTime(event.startISO, event.endISO)}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0 ml-2" />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
