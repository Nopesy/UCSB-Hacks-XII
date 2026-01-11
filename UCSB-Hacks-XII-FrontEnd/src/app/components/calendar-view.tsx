import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { CalendarSync } from './calendar-sync';

interface NewEventForm {
  title: string;
  type: string;
  startTime: string;
  endTime: string;
  date: string;
}

const API_BASE_URL = '';
const FLASK_API_BASE_URL = '/calendar-api';

interface CalendarEvent {
  _id: string;
  userId: string;
  calendarId: string;
  googleId?: string;
  title: string;
  startTs: string;
  endTs: string;
  type?: string;
  description?: string;
  status?: 'malleable' | 'fixed';
}

interface CalendarDay {
  date: number;
  isCurrentMonth: boolean;
  events: CalendarEvent[];
  stressLevel?: 'stable' | 'building' | 'high-risk';
  year?: number;
  month?: number;
  iso?: string;
}

export function CalendarView() {
  console.log('🔵 CalendarView component mounted/rendered');

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getStressColor = (level?: string) => {
    switch (level) {
      case 'stable':
        return 'var(--status-stable)';
      case 'building':
        return 'var(--status-building)';
      case 'high-risk':
        return 'var(--status-high-risk)';
      default:
        return 'transparent';
    }
  };

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const years = Array.from({length: 11}, (_, i) => 2020 + i);

  const [viewYear, setViewYear] = useState<number>(2026);
  const [viewMonth, setViewMonth] = useState<number>(0); // 0 = Jan
  const [viewMode, setViewMode] = useState<'month'|'week'>('month');

  // Clear event selection when switching view modes
  useEffect(() => {
    setSelectedSlot(null);
  }, [viewMode]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const [selectedDate, setSelectedDate] = useState<string | null>(`${viewYear}-${pad(viewMonth+1)}-11`);
  const [selectedSlot, setSelectedSlot] = useState<{iso: string; hour: number; eventId?: string} | null>(null);
  const hours = Array.from({ length: 24 }, (_, i) => i); // 0 - 23 (12am - 11pm)
  const formatHour = (h: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${ampm}`;
  };

  function generateWeekDays(refDate: Date) {
    const start = new Date(refDate);
    const dayOfWeek = start.getDay(); // 0 = Sunday
    start.setDate(start.getDate() - dayOfWeek); // move to start of week (Sunday)
    const res: CalendarDay[] = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      res.push({
        date: d.getDate(),
        isCurrentMonth: d.getMonth() === refDate.getMonth(),
        events: [],
        year: d.getFullYear(),
        month: d.getMonth(),
        iso: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
      } as CalendarDay);
    }

    return res;
  }

  function generateCalendarDays(year: number, month: number) {
    const firstOfMonth = new Date(year, month, 1);
    const startDay = firstOfMonth.getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const totalCells = 42; // 6 weeks
    const result: CalendarDay[] = [];

    for (let i = 0; i < totalCells; i++) {
      const dayNumber = i - startDay + 1;
      let dateNum: number;
      let isCurrentMonth = false;
      let cellYear = year;
      let cellMonth = month;

      if (dayNumber <= 0) {
        dateNum = prevMonthDays + dayNumber;
        isCurrentMonth = false;
        // previous month
        if (month === 0) {
          cellMonth = 11;
          cellYear = year - 1;
        } else {
          cellMonth = month - 1;
        }
      } else if (dayNumber > daysInMonth) {
        dateNum = dayNumber - daysInMonth;
        isCurrentMonth = false;
        // next month
        if (month === 11) {
          cellMonth = 0;
          cellYear = year + 1;
        } else {
          cellMonth = month + 1;
        }
      } else {
        dateNum = dayNumber;
        isCurrentMonth = true;
      }

      result.push({
        date: dateNum,
        isCurrentMonth,
        events: [],
        stressLevel: undefined,
        year: cellYear,
        month: cellMonth,
        iso: `${cellYear}-${pad(cellMonth+1)}-${pad(dateNum)}`,
      } as unknown as CalendarDay);
    }

    return result;
  }


  // State for events
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Fetch events for the current month
  useEffect(() => {
    async function fetchEvents() {
      setLoadingEvents(true);
      setEventsError(null);
      try {
        const start = `${viewYear}-${pad(viewMonth+1)}-01`;
        const endDate = new Date(viewYear, viewMonth + 1, 0);
        const end = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}`;
        console.log(`Fetching events from ${start} to ${end}`);
        const res = await fetch(`${API_BASE_URL}/api/events?user_id=default_user&start=${start}&end=${end}`);
        const data = await res.json();
        console.log(`Received ${data.events?.length || 0} events from MongoDB:`, data.events);
        setEvents(data.events || []);
      } catch (err) {
        console.error('Error fetching events:', err);
        setEventsError('Failed to fetch events');
      } finally {
        setLoadingEvents(false);
      }
    }
    fetchEvents();
  }, [viewYear, viewMonth]);

  // Map events to days
  function mapEventsToDays(days: CalendarDay[], events: CalendarEvent[]): CalendarDay[] {
    const dayMap: { [iso: string]: CalendarDay } = {};
    days.forEach(day => { dayMap[day.iso!] = { ...day, events: [] }; });

    console.log(`Mapping ${events.length} events to ${days.length} days`);

    events.forEach(event => {
      const date = new Date(event.startTs);
      const iso = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;

      if (dayMap[iso]) {
        console.log(`Mapping event "${event.title}" to ${iso}`);
        dayMap[iso].events.push({
          ...event,
          type: event.type || 'class',
        });
      } else {
        console.log(`No day found for event "${event.title}" on ${iso}`);
      }
    });

    const result = Object.values(dayMap);
    const daysWithEvents = result.filter(d => d.events.length > 0);
    console.log(`Result: ${daysWithEvents.length} days have events`);

    return result;
  }

  const calendarDays = mapEventsToDays(generateCalendarDays(viewYear, viewMonth), events);
  const selectedDay = calendarDays.find(d => d.iso === selectedDate);

  const canPrev = !(viewYear === 2020 && viewMonth === 0);
  const canNext = !(viewYear === 2030 && viewMonth === 11);

  function prevMonth() {
    if (!canPrev) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (!canNext) return;
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function prevWeek() {
    const ref = selectedDay ? new Date(selectedDay.year!, selectedDay.month!, selectedDay.date) : new Date(viewYear, viewMonth, 1);
    const newDate = new Date(ref);
    newDate.setDate(ref.getDate() - 7);
    if (newDate < new Date(2020, 0, 1)) return;
    setViewYear(newDate.getFullYear());
    setViewMonth(newDate.getMonth());
    setSelectedDate(`${newDate.getFullYear()}-${pad(newDate.getMonth()+1)}-${pad(newDate.getDate())}`);
  }

  function nextWeek() {
    const ref = selectedDay ? new Date(selectedDay.year!, selectedDay.month!, selectedDay.date) : new Date(viewYear, viewMonth, 1);
    const newDate = new Date(ref);
    newDate.setDate(ref.getDate() + 7);
    if (newDate > new Date(2030, 11, 31)) return;
    setViewYear(newDate.getFullYear());
    setViewMonth(newDate.getMonth());
    setSelectedDate(`${newDate.getFullYear()}-${pad(newDate.getMonth()+1)}-${pad(newDate.getDate())}`);
  }

  function onSelectDay(day: CalendarDay) {
    if (!day.isCurrentMonth) {
      setViewYear(day.year ?? viewYear);
      setViewMonth(day.month ?? viewMonth);
    }

    setSelectedDate(day.iso ?? null);
    setSelectedSlot(null); // Clear selected event to show all events for the day
  }

  const refDateForWeek = selectedDay ? new Date(selectedDay.year!, selectedDay.month!, selectedDay.date) : new Date(viewYear, viewMonth, 1);
  // Map events to week days
  const weekDays = mapEventsToDays(generateWeekDays(refDateForWeek), events);

  const selectedDateObj = selectedDay ? new Date(selectedDay.year!, selectedDay.month!, selectedDay.date) : null;

  const [loadingNapTimes, setLoadingNapTimes] = useState(false);
  const [napEvents, setNapEvents] = useState<any[]>([]);
  const [napError, setNapError] = useState<string | null>(null);

  const [loadingMealTimes, setLoadingMealTimes] = useState(false);
  const [mealEvents, setMealEvents] = useState<any[]>([]);
  const [mealError, setMealError] = useState<string | null>(null);

  const [loadingBurnout, setLoadingBurnout] = useState(false);
  const [burnoutScore, setBurnoutScore] = useState<number | null>(null);
  const [burnoutStatus, setBurnoutStatus] = useState<string | null>(null);
  const [burnoutError, setBurnoutError] = useState<string | null>(null);

  const [addingEvent, setAddingEvent] = useState<string | null>(null);

  // New event form state
  const [showNewEventForm, setShowNewEventForm] = useState(false);
  const [newEventForm, setNewEventForm] = useState<NewEventForm>({
    title: '',
    type: 'class',
    startTime: '09:00',
    endTime: '10:00',
    date: '',
  });
  const [savingNewEvent, setSavingNewEvent] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [editingEventType, setEditingEventType] = useState<string | null>(null);
  const [editingEventTime, setEditingEventTime] = useState<string | null>(null);
  const [editTimeForm, setEditTimeForm] = useState<{ startTime: string; endTime: string }>({ startTime: '', endTime: '' });
  const [savingEventTime, setSavingEventTime] = useState(false);

  const eventTypeOptions = ['class', 'exam', 'assignment', 'meeting', 'work', 'personal', 'meal', 'nap', 'exercise', 'other'];

  // Start editing event time
  const handleStartEditTime = (event: CalendarEvent) => {
    const startDate = new Date(event.startTs);
    const endDate = new Date(event.endTs);
    setEditTimeForm({
      startTime: `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`,
      endTime: `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`,
    });
    setEditingEventTime(event._id);
  };

  // Save event time changes
  const handleSaveEventTime = async (event: CalendarEvent) => {
    setSavingEventTime(true);
    try {
      const eventDate = new Date(event.startTs);
      const dateStr = `${eventDate.getFullYear()}-${pad(eventDate.getMonth() + 1)}-${pad(eventDate.getDate())}`;
      const newStartTs = `${dateStr}T${editTimeForm.startTime}:00`;
      const newEndTs = `${dateStr}T${editTimeForm.endTime}:00`;

      const response = await fetch(`${API_BASE_URL}/api/events/${event._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTs: newStartTs, endTs: newEndTs }),
      });

      if (response.ok) {
        // Update local state
        setEvents(prevEvents =>
          prevEvents.map(e =>
            e._id === event._id ? { ...e, startTs: newStartTs, endTs: newEndTs } : e
          )
        );
        setEditingEventTime(null);
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || 'Failed to update event time');
      }
    } catch (error) {
      console.error('Error updating event time:', error);
      alert('Failed to update event time');
    } finally {
      setSavingEventTime(false);
    }
  };

  // Open new event form for a specific date
  const handleOpenNewEventForm = (date: string) => {
    setSelectedSlot(null); // Clear any selected event slot
    setNewEventForm({
      title: '',
      type: 'class',
      startTime: '09:00',
      endTime: '10:00',
      date: date,
    });
    setShowNewEventForm(true);
  };

  // Save new event
  const handleSaveNewEvent = async () => {
    if (!newEventForm.title.trim() || !newEventForm.date) return;

    setSavingNewEvent(true);
    try {
      const startTs = `${newEventForm.date}T${newEventForm.startTime}:00`;
      const endTs = `${newEventForm.date}T${newEventForm.endTime}:00`;

      const response = await fetch(`${API_BASE_URL}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'default_user',
          calendarId: 'manual',
          title: newEventForm.title,
          startTs,
          endTs,
          type: newEventForm.type,
          status: 'fixed',
        }),
      });

      if (response.ok) {
        // Refresh events
        const start = `${viewYear}-${pad(viewMonth+1)}-01`;
        const endDate = new Date(viewYear, viewMonth + 1, 0);
        const end = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}`;
        const eventsResponse = await fetch(`${API_BASE_URL}/api/events?user_id=default_user&start=${start}&end=${end}`);
        const eventsData = await eventsResponse.json();
        setEvents(eventsData.events || []);
        setShowNewEventForm(false);
      } else {
        const errorData = await response.json();
        alert(errorData.error || 'Failed to create event');
      }
    } catch (error) {
      console.error('Error creating event:', error);
      alert('Failed to create event');
    } finally {
      setSavingNewEvent(false);
    }
  };

  // Delete event
  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event?')) return;

    setDeletingEventId(eventId);
    try {
      console.log('Deleting event:', eventId);
      const response = await fetch(`${API_BASE_URL}/api/events/${eventId}`, {
        method: 'DELETE',
      });

      console.log('Delete response status:', response.status);
      const data = await response.json().catch(() => ({}));
      console.log('Delete response data:', data);

      if (response.ok) {
        // Remove from local state
        setEvents(prevEvents => prevEvents.filter(e => e._id !== eventId));
        setSelectedSlot(null);
      } else {
        console.error('Delete failed:', response.status, data);
        alert(data.error || 'Failed to delete event');
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Failed to delete event');
    } finally {
      setDeletingEventId(null);
    }
  };

  // Update event type
  const handleUpdateEventType = async (eventId: string, newType: string) => {
    console.log('Updating event type:', eventId, 'to', newType);
    // Close the dropdown immediately so onBlur doesn't interfere
    setEditingEventType(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/events/${eventId}/type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType }),
      });

      console.log('Type update response status:', response.status);
      const data = await response.json().catch(() => ({}));
      console.log('Type update response data:', data);

      if (response.ok) {
        // Update local state
        setEvents(prevEvents =>
          prevEvents.map(e =>
            e._id === eventId ? { ...e, type: newType } : e
          )
        );
      } else {
        console.error('Failed to update event type:', response.status, data);
        alert(data.error || 'Failed to update event type');
      }
    } catch (error) {
      console.error('Error updating event type:', error);
      alert('Failed to update event type');
    }
  };

  const handleAddEventToSchedule = async (eventData: any, eventType: 'nap' | 'meal') => {
    const eventId = `${eventType}-${eventData.start.dateTime}`;
    setAddingEvent(eventId);

    try {
      // Create event in MongoDB
      const response = await fetch(`${API_BASE_URL}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'default_user',
          calendarId: 'ai-recommendations',
          title: eventData.summary,
          description: eventData.description || '',
          startTs: eventData.start.dateTime,
          endTs: eventData.end.dateTime,
          type: eventType,
        }),
      });

      if (response.ok) {
        // Refresh events to show the new one
        const start = `${viewYear}-${pad(viewMonth+1)}-01`;
        const endDate = new Date(viewYear, viewMonth + 1, 0);
        const end = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}`;
        const eventsResponse = await fetch(`${API_BASE_URL}/api/events?user_id=default_user&start=${start}&end=${end}`);
        const eventsData = await eventsResponse.json();
        setEvents(eventsData.events || []);

        // Clear the recommendations
        if (eventType === 'nap') {
          setNapEvents([]);
        } else {
          setMealEvents([]);
        }
      } else {
        alert('Failed to add event to schedule');
      }
    } catch (error) {
      console.error('Error adding event:', error);
      alert('Failed to add event to schedule');
    } finally {
      setAddingEvent(null);
    }
  };

  const handleToggleEventStatus = async (event: CalendarEvent) => {
    const newStatus = event.status === 'malleable' ? 'fixed' : 'malleable';

    try {
      const response = await fetch(`${API_BASE_URL}/api/events/${event._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        // Update the event in the local state
        setEvents(prevEvents =>
          prevEvents.map(e =>
            e._id === event._id ? { ...e, status: newStatus } : e
          )
        );
      } else {
        alert('Failed to update event status');
      }
    } catch (error) {
      console.error('Error updating event status:', error);
      alert('Failed to update event status');
    }
  };

  const handlePredictBurnout = async (date: string) => {
    setLoadingBurnout(true);
    setBurnoutError(null);
    setBurnoutScore(null);
    setBurnoutStatus(null);

    try {
      // First, fetch events for the date (get all events for a wider range to ensure we have enough context)
      const targetDate = new Date(date);
      const start = new Date(targetDate);
      start.setDate(1); // First of the month
      const end = new Date(targetDate);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0); // Last day of the month

      const eventsResponse = await fetch(
        `${API_BASE_URL}/api/events?user_id=default_user&start=${start.toISOString().split('T')[0]}&end=${end.toISOString().split('T')[0]}`
      );
      const eventsData = await eventsResponse.json();

      console.log(`Fetched ${eventsData.events?.length || 0} events for burnout prediction`);

      const response = await fetch(`${FLASK_API_BASE_URL}/api/burnout/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: date,
          user_id: 'default_user',
          events: eventsData.events || [],
          // Using default sleep_time: '00:00' and wake_time: '08:00'
        }),
      });

      const data = await response.json();

      if (data.success) {
        setBurnoutScore(data.score);
        setBurnoutStatus(data.status);
      } else {
        setBurnoutError(data.error || 'Failed to predict burnout');
      }
    } catch (error) {
      console.error('Error predicting burnout:', error);
      setBurnoutError('Failed to connect to API');
    } finally {
      setLoadingBurnout(false);
    }
  };

  const handleGetNapTimes = async () => {
    if (!selectedDate) {
      setNapError('Please select a date first');
      return;
    }

    setLoadingNapTimes(true);
    setNapError(null);
    setNapEvents([]);

    try {
      // Fetch events for the month
      const targetDate = new Date(selectedDate);
      const start = new Date(targetDate);
      start.setDate(1);
      const end = new Date(targetDate);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);

      const eventsResponse = await fetch(
        `${API_BASE_URL}/api/events?user_id=default_user&start=${start.toISOString().split('T')[0]}&end=${end.toISOString().split('T')[0]}`
      );
      const eventsData = await eventsResponse.json();

      const response = await fetch(`${FLASK_API_BASE_URL}/api/nap-times/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: selectedDate,
          user_id: 'default_user',
          events: eventsData.events || [],
          // Using default sleep_time: '00:00' and wake_time: '08:00'
        }),
      });

      const data = await response.json();

      if (data.success) {
        setNapEvents(data.events || []);
        if (data.events.length === 0) {
          setNapError('No nap recommendations available for this date');
        }
      } else {
        setNapError(data.error || 'Failed to calculate nap times');
      }
    } catch (error) {
      console.error('Error fetching nap times:', error);
      setNapError('Failed to connect to API');
    } finally {
      setLoadingNapTimes(false);
    }
  };

  const handleGetMealTimes = async () => {
    if (!selectedDate) {
      setMealError('Please select a date first');
      return;
    }

    setLoadingMealTimes(true);
    setMealError(null);
    setMealEvents([]);

    try {
      // Fetch events for the month
      const targetDate = new Date(selectedDate);
      const start = new Date(targetDate);
      start.setDate(1);
      const end = new Date(targetDate);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);

      const eventsResponse = await fetch(
        `${API_BASE_URL}/api/events?user_id=default_user&start=${start.toISOString().split('T')[0]}&end=${end.toISOString().split('T')[0]}`
      );
      const eventsData = await eventsResponse.json();

      const response = await fetch(`${FLASK_API_BASE_URL}/api/meal-windows/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: selectedDate,
          user_id: 'default_user',
          events: eventsData.events || [],
          // Using default sleep_time: '00:00' and wake_time: '08:00'
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMealEvents(data.events || []);
        if (data.events.length === 0) {
          setMealError('No meal recommendations available for this date');
        }
      } else {
        setMealError(data.error || 'Failed to calculate meal windows');
      }
    } catch (error) {
      console.error('Error fetching meal windows:', error);
      setMealError('Failed to connect to API');
    } finally {
      setLoadingMealTimes(false);
    }
  };

  // Automatically predict burnout when a date is selected
  useEffect(() => {
    if (selectedDate) {
      handlePredictBurnout(selectedDate);
    } else {
      setBurnoutScore(null);
      setBurnoutStatus(null);
      setBurnoutError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  return (
    <div className="space-y-6">
      {/* Calendar Sync Section */}
      <CalendarSync />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-2 bg-card rounded-2xl p-6 shadow-sm border border-border/50">
        {/* Month Header */}
        <div className="flex items-center justify-between mb-6">
          {/* Left: View selector */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">View</label>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as 'month'|'week')}
                className="bg-transparent text-sm text-foreground outline-none px-2 py-1 rounded-md border border-border/0 hover:border-border/50"
                aria-label="View mode"
              >
                <option value="month">Month</option>
                <option value="week">Week</option>
              </select>
            </div>
          </div>

          {/* Right: month/year and chevrons grouped to the far right */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                className="bg-transparent text-lg font-semibold text-foreground outline-none"
                aria-label="Select month"
              >
                {monthNames.map((m, i) => (
                  <option key={m} value={i} className="bg-card text-foreground">{m}</option>
                ))}
              </select>

              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                className="bg-transparent text-lg font-semibold text-foreground outline-none"
                aria-label="Select year"
              >
                {years.map((y) => (
                  <option key={y} value={y} className="bg-card text-foreground">{y}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => (viewMode === 'month' ? prevMonth() : prevWeek())}
                disabled={viewMode === 'month' ? !canPrev : false}
                className={`p-2 rounded-lg transition-colors ${(viewMode === 'month' ? (canPrev ? 'hover:bg-muted/50' : 'opacity-40 cursor-not-allowed') : 'hover:bg-muted/50')}`}
                aria-label="Previous"
              >
                <ChevronLeft className="w-5 h-5 text-muted-foreground" />
              </button>

              <button
                onClick={() => (viewMode === 'month' ? nextMonth() : nextWeek())}
                disabled={viewMode === 'month' ? !canNext : false}
                className={`p-2 rounded-lg transition-colors ${(viewMode === 'month' ? (canNext ? 'hover:bg-muted/50' : 'opacity-40 cursor-not-allowed') : 'hover:bg-muted/50')}`}
                aria-label="Next"
              >
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>

        {/* Calendar Days */}
        {viewMode === 'month' ? (
          <>
            {/* Day Labels - only for month view */}
            <div className="grid grid-cols-7 gap-2 mb-3">
              {days.map(day => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((day, index) => (
              <button
                key={index}
                onClick={() => onSelectDay(day)}
                aria-pressed={day.iso === selectedDate}
                className={`
                  relative aspect-square p-2 rounded-xl transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50
                  ${day.iso === selectedDate ? 'ring-2 ring-primary bg-card shadow-md' : day.isCurrentMonth ? 'bg-background' : 'bg-muted/30'}
                `}
              >
                <div className="flex flex-col h-full">
                  <span
                    className={`text-sm ${
                      day.isCurrentMonth ? (day.iso === selectedDate ? 'text-foreground font-semibold' : 'text-foreground') : 'text-muted-foreground/50'
                    }`}
                  >
                    {day.date}
                  </span>
                  {day.events.length > 0 && (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="flex gap-0.5 flex-wrap justify-center max-w-[80%]">
                        {day.events.map((event, i) => (
                          <div
                            key={i}
                            className="w-1 h-1 rounded-full"
                            style={{
                              backgroundColor: event.status === 'malleable' ? '#fbbf24' : '#C65A1E',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {day.stressLevel && (
                    <div
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
                      style={{ backgroundColor: getStressColor(day.stressLevel) }}
                    />
                  )}
                </div>
              </button>
            ))}
          </div>
          </>
        ) : (
          <div className="overflow-auto">
            {/* Week header */}
            <div className="grid grid-cols-8 border-b border-border/50">
              <div className="p-2" />
              {weekDays.map((d) => (
                <button
                  key={d.iso}
                  onClick={() => onSelectDay(d)}
                  className={`p-2 text-center text-sm font-medium border-l border-border/50 transition-colors ${
                    d.iso === selectedDate ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/30'
                  }`}
                >
                  <div className="text-xs text-muted-foreground">{new Date(d.year!, d.month!, d.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                  <div className="text-sm">{d.date}</div>
                </button>
              ))}
            </div>

            {/* Time grid */}
            <div className="overflow-y-auto max-h-[36rem]">
              <div className="grid grid-cols-8">
                {/* Time labels */}
                <div className="flex flex-col">
                  {hours.map((h) => (
                    <div key={h} className="h-20 text-xs text-muted-foreground py-2 px-2 border-t border-border/50">{formatHour(h)}</div>
                  ))}
                </div>

                {/* Day columns */}
                {weekDays.map((d) => (
                  <div key={d.iso} className="relative flex flex-col border-l border-border/50">
                    {/* Hour cells (background grid) */}
                    {hours.map((h) => {
                      const isSelected = selectedSlot && selectedSlot.iso === d.iso && selectedSlot.hour === h && !selectedSlot.eventId;
                      return (
                        <div
                          key={h}
                          className={`h-20 border-t border-border/50 transition-colors ${isSelected ? 'bg-card ring-2 ring-primary' : 'hover:bg-muted/30'}`}
                        />
                      );
                    })}

                    {/* Events positioned absolutely */}
                    {(() => {
                      const HOUR_HEIGHT = 80; // pixels per hour

                      // Sort events by start time
                      const sortedEvents = [...d.events].sort((a, b) =>
                        new Date(a.startTs).getTime() - new Date(b.startTs).getTime()
                      );

                      // Calculate layout with vertical space splitting for overlaps
                      const eventsWithLayout = sortedEvents.map((event, idx) => {
                        const start = new Date(event.startTs);
                        const end = new Date(event.endTs);
                        const startMinutes = start.getHours() * 60 + start.getMinutes();
                        const endMinutes = end.getHours() * 60 + end.getMinutes();

                        // Find overlapping events that started before this one
                        const overlappingBefore = sortedEvents.slice(0, idx).filter(prevEvent => {
                          const prevEnd = new Date(prevEvent.endTs);
                          const prevEndMinutes = prevEnd.getHours() * 60 + prevEnd.getMinutes();
                          return prevEndMinutes > startMinutes;
                        });

                        // Find overlapping events that start after this one
                        const overlappingAfter = sortedEvents.slice(idx + 1).filter(nextEvent => {
                          const nextStart = new Date(nextEvent.startTs);
                          const nextStartMinutes = nextStart.getHours() * 60 + nextStart.getMinutes();
                          return nextStartMinutes < endMinutes;
                        });

                        return {
                          event,
                          startMinutes,
                          endMinutes,
                          overlappingBefore,
                          overlappingAfter,
                        };
                      });

                      return eventsWithLayout.map(({ event, startMinutes, endMinutes, overlappingBefore, overlappingAfter }, idx) => {
                        // Calculate display bounds (may be clipped due to overlaps)
                        let displayStartMinutes = startMinutes;
                        let displayEndMinutes = endMinutes;

                        // If there's an overlapping event before, split the shared space
                        if (overlappingBefore.length > 0) {
                          // Find the latest-ending overlapping event before this one
                          const latestOverlap = overlappingBefore.reduce((latest, evt) => {
                            const evtEnd = new Date(evt.endTs);
                            const evtEndMin = evtEnd.getHours() * 60 + evtEnd.getMinutes();
                            const latestEnd = new Date(latest.endTs);
                            const latestEndMin = latestEnd.getHours() * 60 + latestEnd.getMinutes();
                            return evtEndMin > latestEndMin ? evt : latest;
                          });
                          const overlapEndMinutes = new Date(latestOverlap.endTs).getHours() * 60 + new Date(latestOverlap.endTs).getMinutes();
                          // Split point is midway through the overlap
                          const splitPoint = startMinutes + (Math.min(overlapEndMinutes, endMinutes) - startMinutes) / 2;
                          displayStartMinutes = splitPoint;
                        }

                        // If there's an overlapping event after, split the shared space
                        if (overlappingAfter.length > 0) {
                          // Find the earliest-starting overlapping event after this one
                          const earliestOverlap = overlappingAfter.reduce((earliest, evt) => {
                            const evtStart = new Date(evt.startTs);
                            const evtStartMin = evtStart.getHours() * 60 + evtStart.getMinutes();
                            const earliestStart = new Date(earliest.startTs);
                            const earliestStartMin = earliestStart.getHours() * 60 + earliestStart.getMinutes();
                            return evtStartMin < earliestStartMin ? evt : earliest;
                          });
                          const overlapStartMinutes = new Date(earliestOverlap.startTs).getHours() * 60 + new Date(earliestOverlap.startTs).getMinutes();
                          // Split point is midway through the overlap
                          const splitPoint = overlapStartMinutes + (Math.min(endMinutes, new Date(earliestOverlap.endTs).getHours() * 60 + new Date(earliestOverlap.endTs).getMinutes()) - overlapStartMinutes) / 2;
                          displayEndMinutes = Math.max(displayStartMinutes + 15, splitPoint); // Ensure minimum height
                        }

                        const topOffset = (displayStartMinutes / 60) * HOUR_HEIGHT;
                        const height = ((displayEndMinutes - displayStartMinutes) / 60) * HOUR_HEIGHT;

                        const eventSelected = selectedSlot && selectedSlot.iso === d.iso && selectedSlot.eventId === event._id;
                        const statusColor = event.status === 'malleable' ? '#fbbf24' : '#6b7280';

                        // Determine which side the indicator line should be on
                        // First event (no overlap before): line on left
                        // Later event (has overlap before): line on right
                        const lineOnRight = overlappingBefore.length > 0;

                        // Calculate hangover info for the OTHER event's overlap indicator
                        // If this event has overlap before, we show the previous event's hangover on our left edge
                        // If this event has overlap after, we show the next event's hangover on our right edge

                        // For the earlier event (has overlappingAfter): its bottom gets cut off
                        // The hangover strip should appear on the LEFT side of the NEXT box
                        // For the later event (has overlappingBefore): its top gets cut off
                        // The hangover strip should appear on the RIGHT side of the PREVIOUS box

                        // Calculate the hangover strip that appears on THIS box (showing where the OTHER event extends)
                        let leftHangoverHeight = 0;
                        let leftHangoverTop = 0;
                        let rightHangoverHeight = 0;
                        let rightHangoverBottom = 0;

                        // If we have overlap before, show the previous event's extension on our left edge
                        if (overlappingBefore.length > 0) {
                          const latestOverlap = overlappingBefore.reduce((latest, evt) => {
                            const evtEnd = new Date(evt.endTs);
                            const latestEnd = new Date(latest.endTs);
                            return evtEnd > latestEnd ? evt : latest;
                          });
                          const prevEndMinutes = new Date(latestOverlap.endTs).getHours() * 60 + new Date(latestOverlap.endTs).getMinutes();
                          // The previous event's hangover extends from our display start to where it actually ends
                          if (prevEndMinutes > displayStartMinutes) {
                            leftHangoverHeight = ((prevEndMinutes - displayStartMinutes) / 60) * HOUR_HEIGHT;
                            leftHangoverTop = 0; // starts at top of our box
                          }
                        }

                        // If we have overlap after, show the next event's extension on our right edge
                        if (overlappingAfter.length > 0) {
                          const earliestOverlap = overlappingAfter.reduce((earliest, evt) => {
                            const evtStart = new Date(evt.startTs);
                            const earliestStart = new Date(earliest.startTs);
                            return evtStart < earliestStart ? evt : earliest;
                          });
                          const nextStartMinutes = new Date(earliestOverlap.startTs).getHours() * 60 + new Date(earliestOverlap.startTs).getMinutes();
                          // The next event's hangover extends from where it actually starts to our display end
                          if (nextStartMinutes < displayEndMinutes) {
                            rightHangoverHeight = ((displayEndMinutes - nextStartMinutes) / 60) * HOUR_HEIGHT;
                            rightHangoverBottom = 0; // ends at bottom of our box
                          }
                        }

                        return (
                          <button
                            key={event._id || idx}
                            onClick={() => {
                              if (eventSelected) {
                                setSelectedSlot(null);
                              } else {
                                setSelectedSlot({ iso: d.iso!, hour: Math.floor(startMinutes / 60), eventId: event._id });
                                setSelectedDate(d.iso!);
                              }
                            }}
                            className={`absolute text-xs font-medium text-foreground bg-primary/10 rounded px-2 py-1 text-left transition-all ${eventSelected ? 'ring-2 ring-primary bg-primary/20' : ''}`}
                            style={{
                              top: `${topOffset}px`,
                              height: `${Math.max(height, 24)}px`,
                              left: '4px',
                              right: '4px',
                              zIndex: eventSelected ? 100 : 10,
                              overflow: 'visible',
                              borderLeft: !lineOnRight ? `3px solid ${statusColor}` : 'none',
                              borderRight: lineOnRight ? `3px solid ${statusColor}` : 'none',
                            }}
                            aria-pressed={!!eventSelected}
                            title={event.title}
                          >
                            {/* Left hangover strip - shows where the PREVIOUS event extends into our time */}
                            {leftHangoverHeight > 0 && (
                              <div
                                className="absolute pointer-events-none"
                                style={{
                                  top: `${leftHangoverTop}px`,
                                  left: '0',
                                  width: '3px',
                                  height: `${leftHangoverHeight}px`,
                                  backgroundColor: 'rgba(239, 68, 68, 0.5)',
                                  borderRadius: '1px',
                                }}
                              />
                            )}
                            {/* Right hangover strip - shows where the NEXT event extends into our time */}
                            {rightHangoverHeight > 0 && (
                              <div
                                className="absolute pointer-events-none"
                                style={{
                                  bottom: `${rightHangoverBottom}px`,
                                  right: '0',
                                  width: '3px',
                                  height: `${rightHangoverHeight}px`,
                                  backgroundColor: 'rgba(239, 68, 68, 0.5)',
                                  borderRadius: '1px',
                                }}
                              />
                            )}
                            {/* Content area with clipping */}
                            <div className={`line-clamp-3 break-words leading-tight text-[11px] overflow-hidden h-full ${lineOnRight ? 'pr-2' : 'pl-2'}`}>
                              {event.title}
                            </div>
                          </button>
                        );
                      });
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-6 mt-6 pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--status-stable)' }} />
            <span className="text-xs text-muted-foreground">Stable</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--status-building)' }} />
            <span className="text-xs text-muted-foreground">Building</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--status-high-risk)' }} />
            <span className="text-xs text-muted-foreground">High Risk</span>
          </div>
        </div>
      </div>

      {/* Day Details */}
      <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {selectedDateObj ? (
                `${selectedDateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}${selectedSlot && selectedSlot.iso === selectedDay?.iso ? ` — ${formatHour(selectedSlot.hour)}` : ''}`
              ) : `${monthNames[viewMonth]} ${viewYear}`}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">{selectedDateObj ? (selectedSlot && selectedSlot.iso === selectedDay?.iso ? `Selected time: ${formatHour(selectedSlot.hour)}` : "Selected day's schedule") : 'Pick a day to see details'}</p>
          </div>
          <div className="flex items-center gap-3">
            {selectedDate && (
              <button
                onClick={() => handleOpenNewEventForm(selectedDate)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Event
              </button>
            )}
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: selectedDay?.stressLevel ? getStressColor(selectedDay.stressLevel) : 'transparent' }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {/* Show selected event details if an event is selected in week view */}
          {selectedSlot && selectedSlot.eventId
            ? (() => {
                const event = weekDays
                  .flatMap(day => day.events)
                  .find(e => e._id === selectedSlot.eventId);
                if (!event) return null;
                return (
                  <div
                    className="p-4 bg-muted/30 rounded-xl border-l-4"
                    style={{
                      borderColor:
                        event.type === 'exam'
                          ? 'var(--status-high-risk)'
                          : event.type === 'assignment'
                          ? 'var(--status-building)'
                          : 'var(--accent)',
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Editable Time */}
                        {editingEventTime === event._id ? (
                          <div className="flex items-center gap-2 mb-1">
                            <input
                              type="time"
                              value={editTimeForm.startTime}
                              onChange={(e) => setEditTimeForm({ ...editTimeForm, startTime: e.target.value })}
                              className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary w-20"
                            />
                            <span className="text-xs text-muted-foreground">-</span>
                            <input
                              type="time"
                              value={editTimeForm.endTime}
                              onChange={(e) => setEditTimeForm({ ...editTimeForm, endTime: e.target.value })}
                              className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary w-20"
                            />
                            <button
                              onClick={() => handleSaveEventTime(event)}
                              disabled={savingEventTime}
                              className="text-xs text-primary hover:underline disabled:opacity-50"
                            >
                              {savingEventTime ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingEventTime(null)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEditTime(event)}
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline mb-1 cursor-pointer"
                          >
                            {new Date(event.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(event.endTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </button>
                        )}
                        <p className="text-sm font-medium text-foreground">{event.title}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteEvent(event._id)}
                        disabled={deletingEventId === event._id}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete event"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Editable Type */}
                    <div className="mt-2">
                      {editingEventType === event._id ? (
                        <select
                          value={event.type || 'class'}
                          onChange={(e) => handleUpdateEventType(event._id, e.target.value)}
                          onBlur={() => setEditingEventType(null)}
                          autoFocus
                          className="text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                        >
                          {eventTypeOptions.map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditingEventType(event._id)}
                          className="text-xs text-muted-foreground hover:text-foreground capitalize cursor-pointer hover:underline"
                        >
                          {event.type || 'class'}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => handleToggleEventStatus(event)}
                      className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
                      style={{
                        backgroundColor: event.status === 'malleable' ? '#fbbf24' : '#6b7280',
                        color: 'white',
                      }}
                    >
                      {event.status === 'malleable' ? '🔓 Malleable' : '🔒 Fixed'}
                    </button>
                  </div>
                );
              })()
            : selectedDay?.events.map((event, index) => (
                <div
                  key={index}
                  className="p-4 bg-muted/30 rounded-xl border-l-4"
                  style={{
                    borderColor:
                      event.type === 'exam'
                        ? 'var(--status-high-risk)'
                        : event.type === 'assignment'
                        ? 'var(--status-building)'
                        : 'var(--accent)',
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Editable Time */}
                      {editingEventTime === event._id ? (
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="time"
                            value={editTimeForm.startTime}
                            onChange={(e) => setEditTimeForm({ ...editTimeForm, startTime: e.target.value })}
                            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary w-20"
                          />
                          <span className="text-xs text-muted-foreground">-</span>
                          <input
                            type="time"
                            value={editTimeForm.endTime}
                            onChange={(e) => setEditTimeForm({ ...editTimeForm, endTime: e.target.value })}
                            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary w-20"
                          />
                          <button
                            onClick={() => handleSaveEventTime(event)}
                            disabled={savingEventTime}
                            className="text-xs text-primary hover:underline disabled:opacity-50"
                          >
                            {savingEventTime ? '...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingEventTime(null)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartEditTime(event)}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline mb-1 cursor-pointer"
                        >
                          {new Date(event.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(event.endTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      )}
                      <p className="text-sm font-medium text-foreground">{event.title}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteEvent(event._id)}
                      disabled={deletingEventId === event._id}
                      className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete event"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {/* Editable Type */}
                  <div className="mt-2">
                    {editingEventType === event._id ? (
                      <select
                        value={event.type || 'class'}
                        onChange={(e) => handleUpdateEventType(event._id, e.target.value)}
                        onBlur={() => setEditingEventType(null)}
                        autoFocus
                        className="text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                      >
                        {eventTypeOptions.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setEditingEventType(event._id)}
                        className="text-xs text-muted-foreground hover:text-foreground capitalize cursor-pointer hover:underline"
                      >
                        {event.type || 'class'}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggleEventStatus(event)}
                    className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
                    style={{
                      backgroundColor: event.status === 'malleable' ? '#fbbf24' : '#6b7280',
                      color: 'white',
                    }}
                  >
                    {event.status === 'malleable' ? '🔓 Malleable' : '🔒 Fixed'}
                  </button>
                </div>
              ))}
        </div>

        <div className="mt-6 pt-6 border-t border-border/50">
          <div className="flex items-center justify-between text-sm mb-4">
            <span className="text-muted-foreground">Predicted burnout</span>
            {loadingBurnout ? (
              <span className="text-muted-foreground text-xs">Calculating...</span>
            ) : burnoutError ? (
              <span className="text-destructive text-xs">Error</span>
            ) : burnoutScore !== null ? (
              <span 
                className="font-semibold"
                style={{ 
                  color: burnoutStatus === 'stable' ? '#10b981' :
                         burnoutStatus === 'building' ? '#f59e0b' :
                         burnoutStatus === 'high-risk' ? '#fb7185' :
                         burnoutStatus === 'critical' ? '#dc2626' : '#fb7185'
                }}
              >
                {burnoutScore}/100
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Select a date</span>
            )}
          </div>
          {burnoutError && (
            <div className="mb-4 p-2 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-xs text-destructive">{burnoutError}</p>
            </div>
          )}

          {/* Nap Times Button */}
          <button
            onClick={handleGetNapTimes}
            disabled={loadingNapTimes || !selectedDate}
            className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium mb-3"
          >
            {loadingNapTimes ? 'Loading Nap Recommendations...' : 'Get Nap Time Recommendations'}
          </button>

          {/* Meal Times Button */}
          <button
            onClick={handleGetMealTimes}
            disabled={loadingMealTimes || !selectedDate}
            className="w-full bg-primary text-primary-foreground py-3 px-4 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {loadingMealTimes ? 'Loading Meal Recommendations...' : 'Get Meal Time Recommendations'}
          </button>

          {/* Nap Times Results */}
          {napError && (
            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{napError}</p>
            </div>
          )}

          {napEvents.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-semibold text-foreground mb-2">Suggested Nap Times:</h4>
              {napEvents.map((event, index) => {
                const startTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                });
                const endTime = new Date(event.end.dateTime).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                });
                const eventId = `nap-${event.start.dateTime}`;
                const isAdding = addingEvent === eventId;
                return (
                  <div
                    key={index}
                    className="p-3 bg-muted/30 rounded-lg border-l-4 border-blue-500"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-foreground">{event.summary}</p>
                      <span className="text-xs text-muted-foreground">{event.duration_minutes} min</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {startTime} - {endTime}
                    </p>
                    {event.description && (
                      <p className="text-xs text-muted-foreground/80 mt-1 mb-2">{event.description}</p>
                    )}
                    <button
                      onClick={() => handleAddEventToSchedule(event, 'nap')}
                      disabled={isAdding}
                      className="mt-2 w-full bg-primary text-primary-foreground py-2 px-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                    >
                      {isAdding ? 'Adding to Schedule...' : 'Add to Schedule'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Meal Times Results */}
          {mealError && (
            <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{mealError}</p>
            </div>
          )}

          {mealEvents.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-semibold text-foreground mb-2">Suggested Meal Times:</h4>
              {mealEvents.sort((a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime()).map((event, index) => {
                const startTime = new Date(event.start.dateTime).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                });
                const endTime = new Date(event.end.dateTime).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                });
                const mealTypeColors: Record<string, string> = {
                  breakfast: 'border-yellow-500',
                  lunch: 'border-orange-500',
                  dinner: 'border-red-500',
                  snack: 'border-purple-500'
                };
                const borderColor = mealTypeColors[event.meal_type] || 'border-gray-500';
                const eventId = `meal-${event.start.dateTime}`;
                const isAdding = addingEvent === eventId;
                return (
                  <div
                    key={index}
                    className={`p-3 bg-muted/30 rounded-lg border-l-4 ${borderColor}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-foreground">{event.summary}</p>
                      <span className="text-xs text-muted-foreground">{event.duration_minutes} min</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {startTime} - {endTime}
                    </p>
                    {event.description && (
                      <p className="text-xs text-muted-foreground/80 mt-1 mb-2">{event.description}</p>
                    )}
                    <button
                      onClick={() => handleAddEventToSchedule(event, 'meal')}
                      disabled={isAdding}
                      className="mt-2 w-full bg-primary text-primary-foreground py-2 px-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                    >
                      {isAdding ? 'Adding to Schedule...' : 'Add to Schedule'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* New Event Form Modal */}
      {showNewEventForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 shadow-lg border border-border/50 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">Add New Event</h3>
              <button
                onClick={() => setShowNewEventForm(false)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Event Title */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Event Title</label>
                <input
                  type="text"
                  value={newEventForm.title}
                  onChange={(e) => setNewEventForm({ ...newEventForm, title: e.target.value })}
                  placeholder="Enter event title"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Event Type */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Event Type</label>
                <select
                  value={newEventForm.type}
                  onChange={(e) => setNewEventForm({ ...newEventForm, type: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground outline-none focus:ring-2 focus:ring-primary"
                >
                  {eventTypeOptions.map(type => (
                    <option key={type} value={type} className="capitalize">{type}</option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Date</label>
                <input
                  type="date"
                  value={newEventForm.date}
                  onChange={(e) => setNewEventForm({ ...newEventForm, date: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Time Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Start Time</label>
                  <input
                    type="time"
                    value={newEventForm.startTime}
                    onChange={(e) => setNewEventForm({ ...newEventForm, startTime: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">End Time</label>
                  <input
                    type="time"
                    value={newEventForm.endTime}
                    onChange={(e) => setNewEventForm({ ...newEventForm, endTime: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowNewEventForm(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-muted-foreground bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewEvent}
                disabled={savingNewEvent || !newEventForm.title.trim()}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingNewEvent ? 'Saving...' : 'Add Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
