import { useState, useEffect } from 'react';
import { Calendar, Check } from 'lucide-react';

interface GoogleCalendar {
  id: string;
  summary: string;
  description: string;
  primary: boolean;
  backgroundColor: string;
}

export function CalendarSync() {
  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    has_synced_calendars: boolean;
    synced_calendar_count: number;
  } | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalendarList, setShowCalendarList] = useState(false);

  const API_BASE = 'http://localhost:5001';
  const userId = 'default_user'; // In production, get from auth context

  useEffect(() => {
    checkAuthStatus();
  }, []);

  async function checkAuthStatus() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });

      const data = await response.json();
      setAuthStatus(data);

      // Only load calendars if authenticated but NOT yet synced
      if (data.authenticated && !data.has_synced_calendars) {
        loadCalendars();
      }
    } catch (err) {
      console.error('Error checking auth status:', err);
    }
  }

  async function initiateOAuth() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/oauth/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });

      const data = await response.json();

      if (data.authorization_url) {
        // Open OAuth flow in popup window
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;

        const popup = window.open(
          data.authorization_url,
          'Google Calendar OAuth',
          `width=${width},height=${height},left=${left},top=${top}`
        );

        // Listen for message from popup
        const messageHandler = (event: MessageEvent) => {
          // Verify the message is from our backend
          if (event.origin !== 'http://localhost:5001') return;

          if (event.data.type === 'oauth-success') {
            window.removeEventListener('message', messageHandler);
            checkAuthStatus();
            setLoading(false);
          } else if (event.data.type === 'oauth-error') {
            window.removeEventListener('message', messageHandler);
            setError(event.data.error || 'OAuth failed');
            setLoading(false);
          }
        };

        window.addEventListener('message', messageHandler);

        // Also poll for popup close as fallback
        const pollTimer = setInterval(() => {
          if (popup && popup.closed) {
            clearInterval(pollTimer);
            window.removeEventListener('message', messageHandler);
            // Check if auth succeeded
            setTimeout(() => {
              checkAuthStatus();
              setLoading(false);
            }, 1000);
          }
        }, 500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate OAuth');
      setLoading(false);
    }
  }

  async function loadCalendars() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/calendars/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });

      const data = await response.json();

      if (data.calendars) {
        setCalendars(data.calendars);
        setShowCalendarList(true);

        // Pre-select primary calendar
        const primaryCalendar = data.calendars.find((cal: GoogleCalendar) => cal.primary);
        if (primaryCalendar) {
          setSelectedCalendarIds([primaryCalendar.id]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendars');
    } finally {
      setLoading(false);
    }
  }

  async function syncSelectedCalendars() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/calendars/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          calendar_ids: selectedCalendarIds,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setShowCalendarList(false);
        checkAuthStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync calendars');
    } finally {
      setLoading(false);
    }
  }

  function toggleCalendar(calendarId: string) {
    setSelectedCalendarIds(prev =>
      prev.includes(calendarId)
        ? prev.filter(id => id !== calendarId)
        : [...prev, calendarId]
    );
  }

  // Not authenticated - show sync button
  if (!authStatus?.authenticated) {
    return (
      <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50">
        <div className="flex items-center gap-3 mb-4">
          <Calendar className="w-6 h-6 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Sync Google Calendar</h3>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          Connect your Google Calendar to sync your events and get personalized schedule insights.
        </p>

        <button
          onClick={initiateOAuth}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? 'Connecting...' : 'Connect Google Calendar'}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Authenticated but showing calendar selection
  if (showCalendarList) {
    return (
      <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50">
        <h3 className="text-lg font-semibold text-foreground mb-4">Select Calendars to Sync</h3>

        <p className="text-sm text-muted-foreground mb-6">
          Choose which calendars you want to sync with Burnout Radar.
        </p>

        <div className="space-y-2 mb-6 max-h-96 overflow-y-auto">
          {calendars.map(calendar => (
            <button
              key={calendar.id}
              onClick={() => toggleCalendar(calendar.id)}
              className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors text-left"
            >
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  selectedCalendarIds.includes(calendar.id)
                    ? 'bg-primary border-primary'
                    : 'border-border'
                }`}
              >
                {selectedCalendarIds.includes(calendar.id) && (
                  <Check className="w-3 h-3 text-primary-foreground" />
                )}
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: calendar.backgroundColor }}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {calendar.summary}
                    {calendar.primary && (
                      <span className="ml-2 text-xs text-muted-foreground">(Primary)</span>
                    )}
                  </span>
                </div>
                {calendar.description && (
                  <p className="text-xs text-muted-foreground mt-1">{calendar.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setShowCalendarList(false)}
            className="flex-1 px-4 py-3 rounded-xl border border-border hover:bg-muted/30 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={syncSelectedCalendars}
            disabled={loading || selectedCalendarIds.length === 0}
            className="flex-1 bg-primary text-primary-foreground py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
          >
            {loading ? 'Syncing...' : `Sync ${selectedCalendarIds.length} Calendar${selectedCalendarIds.length !== 1 ? 's' : ''}`}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Authenticated and synced - hide component
  return null;
}