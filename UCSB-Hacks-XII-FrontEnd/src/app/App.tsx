import { CortisolChart } from './components/cortisol-chart';
import { BurnoutMetrics } from './components/burnout-metrics';
import { VoiceCheckIn } from './components/voice-checkin';
import { ActivitySummary } from './components/activity-summary';
import { CalendarView } from './components/calendar-view';
import { EventRating } from './components/event-rating';
import { useEffect, useState, useCallback } from 'react';
import { Login } from './components/Login';
import { SleepCheckInModal } from './components/SleepCheckInModal';
import { OptimizationReviewModal, ProposedChange } from './components/optimization-review-modal';

const API_BASE_URL = '';
const FLASK_API_BASE_URL = '/calendar-api';

interface WeekDayData {
  day: string;
  date: string;
  score: number | null;
  status: string;
  cortisol: number[];
  hasSchedule: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar'>('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [sleep, setSleep] = useState<{ sleepTime: string; wakeTime: string } | null>(null);
  const [showSleepModal, setShowSleepModal] = useState(false);
  const [sleepError, setSleepError] = useState<string | null>(null);

  // Schedule optimization state
  const [showOptimizationModal, setShowOptimizationModal] = useState(false);
  const [proposedChanges, setProposedChanges] = useState<ProposedChange[]>([]);
  const [optimizationSummary, setOptimizationSummary] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  // Week burnout data - now fetched dynamically
  const [weekData, setWeekData] = useState<WeekDayData[]>([]);
  const [weekDataLoading, setWeekDataLoading] = useState(true);
  const [weekDataError, setWeekDataError] = useState<string | null>(null);

  // Assignments due this week
  const [assignmentsDue, setAssignmentsDue] = useState<number>(0);

  const formatTime = (t: string) => {
    try {
      const [hh, mm] = t.split(':');
      const date = new Date();
      date.setHours(Number(hh), Number(mm), 0, 0);
      return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch {
      return t;
    }
  };

  // Generate cortisol curve based on burnout score
  const generateCortisolCurve = (score: number | null): number[] => {
    if (score === null) return [20, 25, 30, 30, 25, 20]; // Default flat curve for N/A
    // Higher burnout = higher cortisol levels with steeper peaks
    const baseLevel = 15 + (score / 100) * 20;
    const peakMultiplier = 1 + (score / 100) * 0.8;
    return [
      Math.round(baseLevel),
      Math.round(baseLevel * 1.3 * peakMultiplier),
      Math.round(baseLevel * 1.6 * peakMultiplier),
      Math.round(baseLevel * 1.8 * peakMultiplier),
      Math.round(baseLevel * 1.5 * peakMultiplier),
      Math.round(baseLevel * 1.2),
    ];
  };

  // Fetch week burnout data from cache (calendar view populates the cache)
  const fetchWeekBurnout = useCallback(async () => {
    setWeekDataLoading(true);
    setWeekDataError(null);

    try {
      // Generate dates for the next 7 days
      const today = new Date();
      const dates: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        dates.push(date);
      }

      // First, check if we have any events (schedule is synced)
      const startDate = dates[0].toISOString().split('T')[0];
      // Add one day to end date to make it inclusive (API uses < for end date)
      const endDateObj = new Date(dates[6]);
      endDateObj.setDate(endDateObj.getDate() + 1);
      const endDate = endDateObj.toISOString().split('T')[0];

      const eventsResponse = await fetch(
        `${API_BASE_URL}/api/events?user_id=default_user&start=${startDate}&end=${endDate}`
      );
      const eventsData = await eventsResponse.json();
      const events = eventsData.events || [];

      // Count assignments due this week
      const assignmentsCount = events.filter((e: { type?: string }) => e.type === 'assignment').length;
      console.log(`[App] Week range: ${startDate} to ${endDate}`);
      console.log(`[App] Found ${events.length} events, ${assignmentsCount} assignments`);
      console.log(`[App] Assignment events:`, events.filter((e: { type?: string }) => e.type === 'assignment'));
      setAssignmentsDue(assignmentsCount);

      const hasSchedule = events.length > 0;

      if (!hasSchedule) {
        // No schedule synced - show N/A for all days
        const emptyWeek: WeekDayData[] = dates.map((date) => ({
          day: date.toLocaleDateString(undefined, { weekday: 'short' }),
          date: `${date.getMonth() + 1}/${date.getDate()}`,
          score: null,
          status: 'na',
          cortisol: generateCortisolCurve(null),
          hasSchedule: false,
        }));
        setWeekData(emptyWeek);
        setWeekDataLoading(false);
        return;
      }

      // Fetch burnout predictions from cache (populated by calendar view)
      const cacheResponse = await fetch(
        `${FLASK_API_BASE_URL}/api/burnout/cache?user_id=default_user`
      );
      const cacheData = await cacheResponse.json();
      const cache = cacheData.predictions || {};

      // Build week data from cache
      const predictions: WeekDayData[] = dates.map((date) => {
        const dateStr = date.toISOString().split('T')[0];
        const cached = cache[dateStr];

        if (cached) {
          return {
            day: date.toLocaleDateString(undefined, { weekday: 'short' }),
            date: `${date.getMonth() + 1}/${date.getDate()}`,
            score: cached.score,
            status: cached.status,
            cortisol: generateCortisolCurve(cached.score),
            hasSchedule: true,
          };
        }

        // No cache entry - show N/A (calendar view will populate cache)
        return {
          day: date.toLocaleDateString(undefined, { weekday: 'short' }),
          date: `${date.getMonth() + 1}/${date.getDate()}`,
          score: null,
          status: 'na',
          cortisol: generateCortisolCurve(null),
          hasSchedule: true,
        };
      });

      setWeekData(predictions);
    } catch (err) {
      console.error('Error fetching week burnout:', err);
      setWeekDataError('Failed to load burnout data');
      // Set default empty state on error
      const today = new Date();
      const emptyWeek: WeekDayData[] = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        return {
          day: date.toLocaleDateString(undefined, { weekday: 'short' }),
          date: `${date.getMonth() + 1}/${date.getDate()}`,
          score: null,
          status: 'na',
          cortisol: generateCortisolCurve(null),
          hasSchedule: false,
        };
      });
      setWeekData(emptyWeek);
    } finally {
      setWeekDataLoading(false);
    }
  }, []);

  // Fetch week burnout data when component mounts or when switching to dashboard
  useEffect(() => {
    if (isAuthenticated && activeTab === 'dashboard') {
      fetchWeekBurnout();
    }
  }, [isAuthenticated, activeTab, fetchWeekBurnout]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch('/api/sleep/today');
        if (!mounted) return;
        console.log('[App] GET /api/sleep/today status:', res.status, res.statusText);
        const resText = await res.text().catch(() => '');
        let resBody: any = resText;
        try {
          resBody = resText ? JSON.parse(resText) : resBody;
        } catch (e) {
          // non-JSON response
        }
        console.log('[App] GET /api/sleep/today body:', resBody);

        if (res.status === 200) {
          const data = (typeof resBody === 'object' ? resBody : null);
          setSleep(data);
          setShowSleepModal(false);
        } else if (res.status === 404) {
          setShowSleepModal(true);
        } else {
          setShowSleepModal(true);
        }
      } catch (err) {
        if (!mounted) return;
        console.error('[App] GET /api/sleep/today fetch error:', err);
        setShowSleepModal(true);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSleepSaved = (data: { sleepTime: string; wakeTime: string }) => {
    setSleep(data);
    setShowSleepModal(false);
    setSleepError(null);
  };

  // Stress curve data - peaks at 8:30 AM (between 8am and 9am data points)
  const todayCortisolData = [
    { hour: '6am', level: 25 },
    { hour: '7am', level: 45 },
    { hour: '8am', level: 78 },
    { hour: '9am', level: 72 },
    { hour: '10am', level: 55 },
    { hour: '12pm', level: 48 },
    { hour: '2pm', level: 42 },
    { hour: '4pm', level: 38 },
    { hour: '6pm', level: 35 },
    { hour: '8pm', level: 30 },
    { hour: '10pm', level: 25 },
    { hour: '12am', level: 20 },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'stable':
      case 'good':
        return '#10b981';
      case 'building':
      case 'moderate':
        return '#f59e0b';
      case 'high-risk':
      case 'elevated':
        return '#fb7185';
      case 'critical':
        return '#dc2626';
      case 'na':
        return '#94a3b8'; // Gray for N/A
      default:
        return '#64748b';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'stable':
      case 'good':
        return 'Stable';
      case 'building':
      case 'moderate':
        return 'Stress Building';
      case 'high-risk':
      case 'elevated':
        return 'High Risk';
      case 'critical':
        return 'Critical';
      case 'na':
        return 'N/A';
      default:
        return 'Unknown';
    }
  };

  // Calculate sleep hours from sleep state
  const calculateSleepHours = (): string | null => {
    if (!sleep) return null;
    try {
      const [sleepH, sleepM] = sleep.sleepTime.split(':').map(Number);
      const [wakeH, wakeM] = sleep.wakeTime.split(':').map(Number);

      let sleepMinutes = sleepH * 60 + sleepM;
      let wakeMinutes = wakeH * 60 + wakeM;

      // Handle crossing midnight
      if (wakeMinutes < sleepMinutes) {
        wakeMinutes += 24 * 60;
      }

      const totalMinutes = wakeMinutes - sleepMinutes;
      const hours = totalMinutes / 60;
      return `${hours.toFixed(1)} hrs`;
    } catch {
      return null;
    }
  };

  // Calculate average burnout from weekData
  const calculateAvgBurnout = (): string | null => {
    const validScores = weekData.filter(d => d.score !== null).map(d => d.score as number);
    if (validScores.length === 0) return null;
    const avg = Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length);
    return `${avg}/100`;
  };

  // Handle Fix My Week button click
  const handleFixMyWeek = async () => {
    setIsOptimizing(true);
    setShowOptimizationModal(true);
    setProposedChanges([]);
    setOptimizationSummary('');

    try {
      const response = await fetch(`${FLASK_API_BASE_URL}/api/schedule/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'default_user',
          sleep_time: sleep?.sleepTime || '00:00',
          wake_time: sleep?.wakeTime || '08:00',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setProposedChanges(data.proposed_changes || []);
        setOptimizationSummary(data.summary || `Found ${data.proposed_changes?.length || 0} optimization(s)`);
      } else {
        setOptimizationSummary(data.error || 'Failed to optimize schedule');
      }
    } catch (err) {
      console.error('Error optimizing schedule:', err);
      setOptimizationSummary('Failed to connect to optimization service');
    } finally {
      setIsOptimizing(false);
    }
  };

  // Apply accepted schedule changes
  const handleApplyChanges = async (acceptedChanges: ProposedChange[]) => {
    setIsApplyingChanges(true);

    try {
      const results: { event: string; error?: string; success?: boolean }[] = [];
      for (const change of acceptedChanges) {
        console.log('Applying change:', change.event_id, change.proposed_start, change.proposed_end);
        const response = await fetch(`${API_BASE_URL}/api/events/${change.event_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startTs: change.proposed_start,
            endTs: change.proposed_end,
          }),
        });
        const data = await response.json();
        console.log('PATCH response:', response.status, data);
        if (!response.ok) {
          results.push({ event: change.event_title, error: data.error || 'Unknown error' });
        } else {
          results.push({ event: change.event_title, success: true });
        }
      }

      // Check if any failed
      const failures = results.filter(r => r.error);
      if (failures.length > 0) {
        alert(`Some changes failed:\n${failures.map(f => `- ${f.event}: ${f.error}`).join('\n')}`);
      }

      // Close modal and refresh data
      setShowOptimizationModal(false);
      setProposedChanges([]);

      // Refresh calendar and burnout data after changes
      setCalendarRefreshKey(prev => prev + 1);
      fetchWeekBurnout();
    } catch (err) {
      console.error('Error applying changes:', err);
      alert('Failed to apply some changes. Please try again.');
    } finally {
      setIsApplyingChanges(false);
    }
  };

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-background font-['Inter',sans-serif] p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl tracking-tight text-foreground">Burnout Radar</h1>
            <p className="text-muted-foreground mt-1">Your week at a glance</p>

            <div className="mt-3 flex items-center gap-3">
              <div className="bg-muted rounded-lg px-3 py-1 text-sm text-muted-foreground">{sleep ? `Last sleep: ${formatTime(sleep.sleepTime)} — ${formatTime(sleep.wakeTime)}` : 'No sleep logged'}</div>
              <button
                onClick={() => setShowSleepModal(true)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Check sleep
              </button>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30"
              onClick={() => setIsAuthenticated(false)}
            >
              Logout
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 p-1 bg-muted/30 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-6 py-2.5 rounded-lg transition-all ${
              activeTab === 'dashboard'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`px-6 py-2.5 rounded-lg transition-all ${
              activeTab === 'calendar'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Calendar
          </button>
        </div>

        {/* Dashboard View */}
        {activeTab === 'dashboard' && (
          <>
            {/* 7-Day Burnout Radar */}
            {weekDataLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-8">
                {Array.from({ length: 7 }).map((_, index) => (
                  <div
                    key={index}
                    className="bg-card rounded-2xl p-5 shadow-sm border border-border/50 animate-pulse"
                  >
                    <div className="h-4 bg-muted rounded w-12 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-8 mb-4"></div>
                    <div className="h-8 bg-muted rounded w-16 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-20 mb-4"></div>
                    <div className="h-12 bg-muted rounded"></div>
                  </div>
                ))}
              </div>
            ) : weekDataError ? (
              <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-6 mb-8 text-center">
                <p className="text-destructive">{weekDataError}</p>
                <button
                  onClick={fetchWeekBurnout}
                  className="mt-3 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                >
                  Retry
                </button>
              </div>
            ) : weekData.length === 0 ? (
              <div className="bg-muted/30 rounded-2xl p-8 mb-8 text-center">
                <p className="text-muted-foreground">No burnout data available. Sync your calendar to get started.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-8">
                {weekData.map((day, index) => (
                  <div
                    key={index}
                    className="bg-card rounded-2xl p-5 shadow-sm border border-border/50 hover:shadow-md transition-shadow"
                  >
                    {/* Day Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm text-muted-foreground">{day.day}</p>
                        <p className="text-xs text-muted-foreground/70">{day.date}</p>
                      </div>
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: getStatusColor(day.status) }}
                      />
                    </div>

                    {/* Burnout Score */}
                    <div className="mb-4">
                      <div className="text-3xl font-semibold text-foreground mb-1">
                        {day.score !== null ? day.score : 'N/A'}
                      </div>
                      <div
                        className="text-xs font-medium"
                        style={{ color: getStatusColor(day.status) }}
                      >
                        {getStatusLabel(day.status)}
                      </div>
                    </div>

                    {/* Mini Cortisol Curve */}
                    <div className="h-12 flex items-end gap-0.5">
                      {day.cortisol.map((value, i) => {
                        const maxValue = Math.max(...day.cortisol);
                        const height = (value / maxValue) * 100;
                        return (
                          <div
                            key={i}
                            className="flex-1 rounded-t-sm transition-all"
                          style={{
                            height: `${height}%`,
                            backgroundColor: getStatusColor(day.status),
                            opacity: 0.3 + (height / 100) * 0.7,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
              </div>
            )}

            {/* Cortisol Chart & Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="space-y-6">
                <CortisolChart data={todayCortisolData} color="#fb7185" />
                <EventRating />
              </div>
              <div className="space-y-6">
                <BurnoutMetrics
                  sleep={calculateSleepHours()}
                  assignments={assignmentsDue > 0 ? String(assignmentsDue) : null}
                  avgStress={calculateAvgBurnout()}
                />
                <VoiceCheckIn onBurnoutUpdated={fetchWeekBurnout} />
              </div>
            </div>
          </>
        )}

        {/* Calendar View */}
        {activeTab === 'calendar' && (
          <>
            <CalendarView key={calendarRefreshKey} />

            {/* Fix My Week Button */}
            <button
              onClick={handleFixMyWeek}
              disabled={isOptimizing}
              className="w-full bg-primary text-primary-foreground py-4 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 mt-8 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isOptimizing ? 'Optimizing...' : 'Fix My Week'}
            </button>
          </>
        )}

        {/* Optimization Review Modal */}
        <OptimizationReviewModal
          isOpen={showOptimizationModal}
          onClose={() => setShowOptimizationModal(false)}
          proposedChanges={proposedChanges}
          summary={optimizationSummary}
          onApplyChanges={handleApplyChanges}
          isApplying={isApplyingChanges}
          isLoading={isOptimizing}
        />

        <SleepCheckInModal
          isOpen={showSleepModal}
          onClose={() => setShowSleepModal(false)}
          onSaved={(d) => handleSleepSaved(d)}
          initial={sleep ?? undefined}
        />      </div>
    </div>
  );
}