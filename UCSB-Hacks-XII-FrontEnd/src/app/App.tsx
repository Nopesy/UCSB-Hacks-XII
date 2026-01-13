import { CortisolChart } from './components/cortisol-chart';
import { BurnoutMetrics } from './components/burnout-metrics';
import { VoiceCheckIn } from './components/voice-checkin';
import { ActivitySummary } from './components/activity-summary';
import { CalendarView } from './components/calendar-view';
import { EventRating } from './components/event-rating';
import { useEffect, useState } from 'react';
import { Login } from './components/Login';
import { SleepCheckInModal } from './components/SleepCheckInModal';

interface WeekDayData {
  day: string;
  date: string;
  score: number;
  status: string;
  cortisol: number[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar'>('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [sleep, setSleep] = useState<{ sleepTime: string; wakeTime: string } | null>(null);
  const [showSleepModal, setShowSleepModal] = useState(false);
  const [sleepError, setSleepError] = useState<string | null>(null);
  
  const [weekData, setWeekData] = useState<WeekDayData[]>([]);
  const [isLoadingBurnout, setIsLoadingBurnout] = useState(true);

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
    // Refresh burnout data with new sleep times
    fetchBurnoutData(data.sleepTime, data.wakeTime);
  };

  // Fetch burnout predictions for the week
  const fetchBurnoutData = async (sleepTime?: string, wakeTime?: string) => {
    setIsLoadingBurnout(true);
    try {
      // Generate dates for the week (last 3 days + today + next 3 days)
      const dates: string[] = [];
      const today = new Date();
      
      // Helper to format date as YYYY-MM-DD in local timezone
      const formatLocalDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      for (let i = -3; i <= 3; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        dates.push(formatLocalDate(date));
      }
      
      console.log('[Burnout] Today:', formatLocalDate(today), 'Fetching dates:', dates);

      // Fetch events from MongoDB first
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];
      let allEvents: any[] = [];
      try {
        const eventsRes = await fetch(`http://localhost:3001/api/events?user_id=default_user&start=${startDate}&end=${endDate}`);
        if (eventsRes.ok) {
          const eventsData = await eventsRes.json();
          allEvents = eventsData.events || [];
        }
      } catch (err) {
        console.error('Failed to fetch events from MongoDB:', err);
      }

      // Fetch burnout predictions for each day
      const predictions = await Promise.all(
        dates.map(async (date) => {
          try {
            const response = await fetch('http://localhost:5001/api/burnout/predict', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                date,
                user_id: 'default_user',
                sleep_time: sleepTime || sleep?.sleepTime || '00:00',
                wake_time: wakeTime || sleep?.wakeTime || '08:00',
                events: allEvents
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error(`Failed to fetch burnout for ${date}:`, response.status, errorText);
              // Return a default prediction instead of null
              return {
                date,
                score: 50,
                status: 'building',
                error: true
              };
            }

            const data = await response.json();
            if (!data.success && data.error) {
              console.error(`Burnout API error for ${date}:`, data.error);
              // Return a default prediction instead of null
              return {
                date,
                score: 50,
                status: 'building',
                error: true
              };
            }
            
            return {
              date,
              score: data.score || 50,
              status: data.status || 'building'
            };
          } catch (error) {
            console.error(`Error fetching burnout for ${date}:`, error);
            // Return a default prediction instead of null
            return {
              date,
              score: 50,
              status: 'building',
              error: true
            };
          }
        })
      );

      // Transform predictions into weekData format
      console.log(`[Burnout] Got ${predictions.length} predictions for dates:`, dates);
      const formattedWeekData: WeekDayData[] = predictions
        .map((prediction, index) => {
          const date = new Date(prediction.date);
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          
          // Generate cortisol curve based on score (simulate hourly data)
          const generateCortisolCurve = (score: number): number[] => {
            const baseLevel = 20;
            const stressMultiplier = score / 100;
            // Simulate cortisol pattern: rise in morning, peak midday, decline evening
            return [
              baseLevel + (10 * stressMultiplier),
              baseLevel + (20 * stressMultiplier),
              baseLevel + (30 * stressMultiplier),
              baseLevel + (35 * stressMultiplier),
              baseLevel + (25 * stressMultiplier),
              baseLevel + (15 * stressMultiplier)
            ].map(v => Math.round(v));
          };

          return {
            day: dayNames[date.getDay()],
            date: `${date.getMonth() + 1}/${date.getDate()}`,
            score: prediction.score,
            status: prediction.status,
            cortisol: generateCortisolCurve(prediction.score)
          };
        });

      setWeekData(formattedWeekData);
    } catch (error) {
      console.error('Error fetching burnout data:', error);
      // Fallback to empty data
      setWeekData([]);
    } finally {
      setIsLoadingBurnout(false);
    }
  };

  // Load burnout data on mount or when sleep data changes
  useEffect(() => {
    if (sleep) {
      fetchBurnoutData(sleep.sleepTime, sleep.wakeTime);
    }
  }, [sleep]);

  const todayCortisolData = [
    { hour: '6am', level: 35 },
    { hour: '8am', level: 50 },
    { hour: '10am', level: 65 },
    { hour: '12pm', level: 75 },
    { hour: '2pm', level: 70 },
    { hour: '4pm', level: 68 },
    { hour: '6pm', level: 60 },
    { hour: '8pm', level: 55 },
    { hour: '10pm', level: 45 },
    { hour: '12am', level: 38 },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'stable':
        return '#10b981';
      case 'building':
        return '#f59e0b';
      case 'high-risk':
        return '#fb7185';
      default:
        return '#64748b';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'stable':
        return 'Stable';
      case 'building':
        return 'Stress Building';
      case 'high-risk':
        return 'High Risk';
      default:
        return 'Unknown';
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-8">
              {isLoadingBurnout ? (
                // Loading skeleton
                Array.from({ length: 7 }).map((_, index) => (
                  <div
                    key={index}
                    className="bg-card rounded-2xl p-5 shadow-sm border border-border/50 animate-pulse"
                  >
                    <div className="h-12 bg-muted rounded mb-4" />
                    <div className="h-8 bg-muted rounded mb-2" />
                    <div className="h-12 bg-muted rounded" />
                  </div>
                ))
              ) : weekData.length === 0 ? (
                // Empty state
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  No burnout data available. Please sync your calendar and ensure your sleep schedule is set.
                </div>
              ) : (
                weekData.map((day, index) => (
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
                      {day.score}
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
              ))
              )}
            </div>

            {/* Cortisol Chart & Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="space-y-6">
                <CortisolChart data={todayCortisolData} color="#fb7185" />
                <EventRating />
              </div>
              <div className="space-y-6">
                <BurnoutMetrics
                  sleep="5.2 hrs"
                  assignments="8"
                  avgStress="68/100"
                />
                <VoiceCheckIn />
              </div>
            </div>
          </>
        )}

        {/* Calendar View */}
        {activeTab === 'calendar' && (
          <>
            <CalendarView />

          </>
        )}
        <SleepCheckInModal
          isOpen={showSleepModal}
          onClose={() => setShowSleepModal(false)}
          onSaved={(d) => handleSleepSaved(d)}
          initial={sleep ?? undefined}
        />      </div>
    </div>
  );
}