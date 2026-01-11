import * as React from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';

type SleepData = { sleepTime: string; wakeTime: string };

export function SleepCheckInModal({
  isOpen,
  onClose,
  onSaved,
  initial,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (data: SleepData) => void;
  initial?: Partial<SleepData>;
}) {
  const [sleepTime, setSleepTime] = React.useState(initial?.sleepTime ?? '');
  const [wakeTime, setWakeTime] = React.useState(initial?.wakeTime ?? '');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setSleepTime(initial?.sleepTime ?? '');
      setWakeTime(initial?.wakeTime ?? '');
      setError(null);
    }
  }, [isOpen, initial]);

  if (!isOpen) return null;

  const validate = () => {
    if (!sleepTime || !wakeTime) {
      setError('Both times are required');
      return false;
    }
    setError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = { sleepTime, wakeTime };
      console.log('[SleepCheckIn] POST /api/sleep request payload:', payload);
      const res = await fetch('/api/sleep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log('[SleepCheckIn] POST /api/sleep response status:', res.status, res.statusText);

      const resText = await res.text().catch(() => '');
      let resBody: any = resText;
      try {
        resBody = resText ? JSON.parse(resText) : resBody;
      } catch (e) {
        // response is not JSON; keep text
      }
      console.log('[SleepCheckIn] POST /api/sleep response body:', resBody);

      if (!res.ok) {
        setError(
          resBody?.message ?? (typeof resBody === 'string' && resBody.length ? resBody : 'Failed to save. Please try again.')
        );
        setLoading(false);
        return;
      }

      const data = (typeof resBody === 'object' ? resBody : { sleepTime, wakeTime }) as SleepData;
      onSaved(data);
      onClose();
    } catch (err) {
      console.error('[SleepCheckIn] POST /api/sleep fetch error:', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.32)' }} />

      <div className="relative w-full max-w-md mx-4">
        <form
          onSubmit={handleSubmit}
          className="bg-card rounded-2xl p-6 shadow-md border border-border/50"
          role="dialog"
          aria-modal="true"
          aria-label="Sleep check-in"
        >
          <h2 className="text-xl font-semibold text-foreground mb-1">Sleep check-in</h2>
          <p className="text-sm text-muted-foreground mb-4">Quickly record your last sleep times.</p>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-2">What time did you sleep?</label>
              <Input
                type="time"
                required
                value={sleepTime}
                onChange={(e) => setSleepTime(e.currentTarget.value)}
                aria-label="Sleep time"
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-2">What time did you wake up?</label>
              <Input
                type="time"
                required
                value={wakeTime}
                onChange={(e) => setWakeTime(e.currentTarget.value)}
                aria-label="Wake time"
              />
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" className="ml-auto" disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" type="button" onClick={onClose} disabled={loading}>
                Skip for now
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
