import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { CalendarSync } from './calendar-sync';

interface CalendarEvent {
  time: string;
  title: string;
  type: 'class' | 'assignment' | 'exam' | 'break';
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

  const pad = (n: number) => String(n).padStart(2, '0');
  const [selectedDate, setSelectedDate] = useState<string | null>(`${viewYear}-${pad(viewMonth+1)}-10`);
  const [selectedSlot, setSelectedSlot] = useState<{iso: string; hour: number} | null>(null);
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

  const calendarDays = generateCalendarDays(viewYear, viewMonth);

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
  const weekDays = generateWeekDays(refDateForWeek);

  const selectedDateObj = selectedDay ? new Date(selectedDay.year!, selectedDay.month!, selectedDay.date) : null;

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
                      const isSelected = selectedSlot && selectedSlot.iso === d.iso && selectedSlot.hour === h;
                      return (
                        <button
                          key={h}
                          onClick={() => setSelectedSlot({ iso: d.iso!, hour: h })}
                          className={`h-12 border-t border-border/50 transition-colors text-left px-2 ${isSelected ? 'bg-card ring-2 ring-primary' : 'hover:bg-muted/30'}`}
                          aria-pressed={isSelected}
                        />
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
              {selectedDateObj ? (
                `${selectedDateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}${selectedSlot && selectedSlot.iso === selectedDay?.iso ? ` — ${formatHour(selectedSlot.hour)}` : ''}`
              ) : `${monthNames[viewMonth]} ${viewYear}`}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">{selectedDateObj ? (selectedSlot && selectedSlot.iso === selectedDay?.iso ? `Selected time: ${formatHour(selectedSlot.hour)}` : "Selected day's schedule") : 'Pick a day to see details'}</p>
          </div>
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: selectedDay?.stressLevel ? getStressColor(selectedDay.stressLevel) : 'transparent' }}
          />
        </div>

        <div className="space-y-3">
          {selectedDay?.events.map((event, index) => (
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
              <p className="text-xs text-muted-foreground mb-1">{event.time}</p>
              <p className="text-sm font-medium text-foreground">{event.title}</p>
              <p className="text-xs text-muted-foreground mt-1 capitalize">{event.type}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-border/50">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Predicted burnout</span>
            <span className="font-semibold text-[#fb7185]">71/100</span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
