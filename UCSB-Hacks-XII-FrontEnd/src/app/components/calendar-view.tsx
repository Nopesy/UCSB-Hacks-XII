import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { CalendarSync } from './calendar-sync';

const EVENTS_API_BASE_URL = 'http://localhost:3001';
const HEALTH_API_BASE_URL = 'http://localhost:5001';

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
  const [selectedDate, setSelectedDate] = useState<string | null>(`${viewYear}-${pad(viewMonth+1)}-10`);
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
        const res = await fetch(`${EVENTS_API_BASE_URL}/api/events?user_id=default_user&start=${start}&end=${end}`);
        const data = await res.json();
        setEvents(data.events || []);
      } catch (err) {
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
    events.forEach(event => {
      const date = new Date(event.startTs);
      const iso = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
      if (dayMap[iso]) {
        dayMap[iso].events.push({
          ...event,
          type: event.type || 'class',
        });
      }
    });
    return Object.values(dayMap);
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

  const handlePredictBurnout = async (date: string) => {
    setLoadingBurnout(true);
    setBurnoutError(null);
    setBurnoutScore(null);
    setBurnoutStatus(null);

    try {
      const response = await fetch(`${HEALTH_API_BASE_URL}/api/burnout/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: date,
          user_id: 'default_user',
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
      setBurnoutError('Failed to connect to API. Make sure the server is running on http://localhost:5001');
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

    // Filter events for the selected date
    const dayEvents = events.filter(e => {
      const eventDate = new Date(e.startTs);
      const iso = `${eventDate.getFullYear()}-${pad(eventDate.getMonth()+1)}-${pad(eventDate.getDate())}`;
      return iso === selectedDate;
    });

    // Fetch sleep entry for the selected date
    let sleepTime = '00:00';
    let wakeTime = '08:00';
    try {
      const sleepRes = await fetch(`${EVENTS_API_BASE_URL}/api/sleep/${selectedDate}?user_id=default_user`);
      if (sleepRes.ok) {
        const sleepData = await sleepRes.json();
        sleepTime = sleepData.sleepTime || sleepTime;
        wakeTime = sleepData.wakeTime || wakeTime;
      }
    } catch (e) {
      // fallback to defaults
    }

    try {
      const response = await fetch(`${HEALTH_API_BASE_URL}/api/nap-times/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: selectedDate,
          user_id: 'default_user',
          events: dayEvents,
          sleep_time: sleepTime,
          wake_time: wakeTime,
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
      setNapError('Failed to connect to API. Make sure the server is running on http://localhost:5001');
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

    // Filter events for the selected date
    const dayEvents = events.filter(e => {
      const eventDate = new Date(e.startTs);
      const iso = `${eventDate.getFullYear()}-${pad(eventDate.getMonth()+1)}-${pad(eventDate.getDate())}`;
      return iso === selectedDate;
    });

    // Fetch sleep entry for the selected date
    let sleepTime = '00:00';
    let wakeTime = '08:00';
    try {
      const sleepRes = await fetch(`${EVENTS_API_BASE_URL}/api/sleep/${selectedDate}?user_id=default_user`);
      if (sleepRes.ok) {
        const sleepData = await sleepRes.json();
        sleepTime = sleepData.sleepTime || sleepTime;
        wakeTime = sleepData.wakeTime || wakeTime;
      }
    } catch (e) {
      // fallback to defaults
    }

    try {
      const response = await fetch(`${HEALTH_API_BASE_URL}/api/meal-windows/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: selectedDate,
          user_id: 'default_user',
          events: dayEvents,
          sleep_time: sleepTime,
          wake_time: wakeTime,
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
      setMealError('Failed to connect to API. Make sure the server is running on http://localhost:5001');
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

        {/* Day Labels */}
        <div className="grid grid-cols-7 gap-2 mb-3">
          {days.map(day => (
            <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        {viewMode === 'month' ? (
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
                      <div className="flex gap-0.5">
                        {day.events.slice(0, 3).map((_, i) => (
                          <div
                            key={i}
                            className="w-1 h-1 rounded-full bg-primary/60"
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
        ) : (
          <div className="overflow-auto">
            {/* Week header */}
            <div className="grid grid-cols-8 border-b border-border/50">
              <div className="p-2" />
              {weekDays.map((d) => (
                <div key={d.iso} className="p-2 text-center text-sm font-medium text-foreground border-l border-border/50">
                  <div className="text-xs text-muted-foreground">{new Date(d.year!, d.month!, d.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                  <div className="text-sm">{d.date}</div>
                </div>
              ))}
            </div>

            {/* Time grid */}
            <div className="overflow-y-auto max-h-[36rem]">
              <div className="grid grid-cols-8">
                {/* Time labels */}
                <div className="flex flex-col">
                  {hours.map((h) => (
                    <div key={h} className="h-12 text-xs text-muted-foreground py-2 px-2 border-t border-border/50">{formatHour(h)}</div>
                  ))}
                </div>

                {/* Day columns */}
                {weekDays.map((d) => (
                  <div key={d.iso} className="flex flex-col border-l border-border/50">
                    {hours.map((h) => {
                      const isSelected = selectedSlot && selectedSlot.iso === d.iso && selectedSlot.hour === h && !selectedSlot.eventId;
                      // Find events for this day and hour
                      const eventsForHour = d.events.filter(event => {
                        const start = new Date(event.startTs);
                        return start.getHours() === h;
                      });
                      return (
                        <div
                          key={h}
                          className={`h-12 border-t border-border/50 transition-colors text-left px-2 ${isSelected ? 'bg-card ring-2 ring-primary' : 'hover:bg-muted/30'}`}
                        >
                          {eventsForHour.map((event, idx) => {
                            const eventSelected = selectedSlot && selectedSlot.iso === d.iso && selectedSlot.hour === h && selectedSlot.eventId === event._id;
                            return (
                              <button
                                key={event._id || idx}
                                onClick={() => {
                                  if (selectedSlot && selectedSlot.iso === d.iso && selectedSlot.hour === h && selectedSlot.eventId === event._id) {
                                    setSelectedSlot(null); // Deselect if already selected
                                  } else {
                                    setSelectedSlot({ iso: d.iso!, hour: h, eventId: event._id });
                                  }
                                }}
                                className={`w-full truncate text-xs font-medium text-foreground bg-primary/10 rounded px-1 py-0.5 mb-0.5 text-left ${eventSelected ? 'ring-2 ring-primary bg-primary/20' : ''}`}
                                aria-pressed={!!eventSelected}
                              >
                                {event.title}
                                <span className="block text-[10px] text-muted-foreground font-normal">
                                  {new Date(event.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(event.endTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
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
              {viewMode === 'week' && selectedSlot && selectedSlot.eventId
                ? (() => {
                    const event = weekDays
                      .flatMap(day => day.events)
                      .find(e => e._id === selectedSlot.eventId);
                    if (!event) return `${monthNames[viewMonth]} ${viewYear}`;
                    const eventDateObj = new Date(event.startTs);
                    return eventDateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
                  })()
                : selectedDateObj
                ? `${selectedDateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}${selectedSlot && selectedSlot.iso === selectedDay?.iso ? ` — ${formatHour(selectedSlot.hour)}` : ''}`
                : `${monthNames[viewMonth]} ${viewYear}`}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {viewMode === 'week' && selectedSlot && selectedSlot.eventId
                ? (() => {
                    const event = weekDays
                      .flatMap(day => day.events)
                      .find(e => e._id === selectedSlot.eventId);
                    if (!event) return '';
                    return `Selected time: ${formatHour(new Date(event.startTs).getHours())}`;
                  })()
                : selectedDateObj
                ? (selectedSlot && selectedSlot.iso === selectedDay?.iso ? `Selected time: ${formatHour(selectedSlot.hour)}` : "Selected day's schedule")
                : 'Pick a day to see details'}
            </p>
          </div>
          <div
            className="w-3 h-3 rounded-full"
            style={{
              backgroundColor:
                viewMode === 'week' && selectedSlot && selectedSlot.eventId
                  ? (() => {
                      const event = weekDays
                        .flatMap(day => day.events)
                        .find(e => e._id === selectedSlot.eventId);
                      return event?.type === 'exam'
                        ? getStressColor('high-risk')
                        : event?.type === 'assignment'
                        ? getStressColor('building')
                        : getStressColor(selectedDay?.stressLevel);
                    })()
                  : selectedDay?.stressLevel
                  ? getStressColor(selectedDay.stressLevel)
                  : 'transparent',
            }}
          />
        </div>

        <div className="space-y-3">
          {/* In week view, show only the clicked event's info and correct day title */}
          {viewMode === 'week' ? (
            selectedSlot && selectedSlot.eventId ? (
              (() => {
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
                    <p className="text-xs text-muted-foreground mb-1">
                      {new Date(event.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(event.endTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-sm font-medium text-foreground">{event.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 capitalize">{event.type}</p>
                  </div>
                );
              })()
            ) : (
              // Only show events for the selected day in week view
              weekDays
                .filter(day => day.iso === selectedDate)
                .flatMap(day => day.events)
                .map((event, index) => (
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
                    <p className="text-xs text-muted-foreground mb-1">
                      {new Date(event.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(event.endTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-sm font-medium text-foreground">{event.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 capitalize">{event.type}</p>
                  </div>
                ))
            )
          ) : (
            // Month view: show all events for the selected day
            selectedDay?.events.map((event, index) => (
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
                <p className="text-xs text-muted-foreground mb-1">
                  {new Date(event.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(event.endTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                <p className="text-xs text-muted-foreground mt-1 capitalize">{event.type}</p>
              </div>
            ))
          )}
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
                      <p className="text-xs text-muted-foreground/80 mt-1">{event.description}</p>
                    )}
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
              {mealEvents.map((event, index) => {
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
                      <p className="text-xs text-muted-foreground/80 mt-1">{event.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
