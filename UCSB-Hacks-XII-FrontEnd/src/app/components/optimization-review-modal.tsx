import { useState } from 'react';
import { X, Check, ArrowRight } from 'lucide-react';

export interface ProposedChange {
  event_id: string;
  event_title: string;
  current_start: string;
  current_end: string;
  proposed_start: string;
  proposed_end: string;
  reasoning: string;
}

interface OptimizationReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposedChanges: ProposedChange[];
  summary: string;
  onApplyChanges: (acceptedChanges: ProposedChange[]) => Promise<void>;
  isApplying: boolean;
  isLoading?: boolean;
}

export function OptimizationReviewModal({
  isOpen,
  onClose,
  proposedChanges,
  summary,
  onApplyChanges,
  isApplying,
  isLoading = false,
}: OptimizationReviewModalProps) {
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject'>>({});

  if (!isOpen) return null;

  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return {
      day: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    };
  };

  // Calculate position on a 24-hour timeline (returns percentage 0-100)
  const getTimePosition = (isoString: string) => {
    const date = new Date(isoString);
    const hours = date.getHours() + date.getMinutes() / 60;
    return (hours / 24) * 100;
  };

  // Get duration as percentage of day
  const getDurationWidth = (startIso: string, endIso: string) => {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return Math.max((durationHours / 24) * 100, 2); // Min 2% width for visibility
  };

  const toggleDecision = (eventId: string, decision: 'accept' | 'reject') => {
    setDecisions((prev) => ({
      ...prev,
      [eventId]: prev[eventId] === decision ? undefined : decision,
    } as Record<string, 'accept' | 'reject'>));
  };

  const acceptAll = () => {
    const allAccepted: Record<string, 'accept' | 'reject'> = {};
    proposedChanges.forEach((change) => {
      allAccepted[change.event_id] = 'accept';
    });
    setDecisions(allAccepted);
  };

  const rejectAll = () => {
    const allRejected: Record<string, 'accept' | 'reject'> = {};
    proposedChanges.forEach((change) => {
      allRejected[change.event_id] = 'reject';
    });
    setDecisions(allRejected);
  };

  const handleApply = async () => {
    const acceptedChanges = proposedChanges.filter(
      (change) => decisions[change.event_id] === 'accept'
    );
    await onApplyChanges(acceptedChanges);
  };

  const acceptedCount = Object.values(decisions).filter((d) => d === 'accept').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-2xl shadow-xl border border-border/50 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/50">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Optimize Your Week</h2>
            <p className="text-sm text-muted-foreground mt-1">{summary}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted/50 rounded-lg transition-colors"
            disabled={isApplying}
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-muted-foreground">Analyzing your schedule...</p>
              <p className="text-sm text-muted-foreground/70 mt-2">
                Finding optimal times for your malleable events
              </p>
            </div>
          ) : proposedChanges.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No optimization suggestions available.</p>
              <p className="text-sm text-muted-foreground/70 mt-2">
                Mark some events as "malleable" to enable optimization.
              </p>
            </div>
          ) : (
            proposedChanges.map((change) => {
              const current = formatDateTime(change.current_start);
              const proposed = formatDateTime(change.proposed_start);
              const decision = decisions[change.event_id];

              return (
                <div
                  key={change.event_id}
                  className={`p-4 rounded-xl border transition-all ${
                    decision === 'accept'
                      ? 'bg-green-500/10 border-green-500/30'
                      : decision === 'reject'
                      ? 'bg-muted/30 border-border/50 opacity-60'
                      : 'bg-muted/30 border-border/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-medium text-foreground">{change.event_title}</h3>

                      {/* Time change text */}
                      <div className="flex items-center gap-2 mt-2 text-sm">
                        <div className="text-muted-foreground">
                          <span className="font-medium">{current.day}</span>
                          <span className="ml-1">{current.time}</span>
                        </div>
                        <ArrowRight className="w-4 h-4 text-primary" />
                        <div className={decision === 'reject' ? 'text-muted-foreground line-through' : 'text-primary font-medium'}>
                          <span>{proposed.day}</span>
                          <span className="ml-1">{proposed.time}</span>
                        </div>
                      </div>

                      {/* Mini timeline visualization */}
                      <div className="mt-3 space-y-1">
                        {/* Timeline labels */}
                        <div className="flex justify-between text-[10px] text-muted-foreground/60 px-0.5">
                          <span>6am</span>
                          <span>12pm</span>
                          <span>6pm</span>
                          <span>12am</span>
                        </div>
                        {/* Before timeline */}
                        <div className="relative h-4 bg-muted/30 rounded-sm overflow-hidden">
                          <div
                            className="absolute h-full bg-muted-foreground/30 rounded-sm"
                            style={{
                              left: `${getTimePosition(change.current_start)}%`,
                              width: `${getDurationWidth(change.current_start, change.current_end)}%`,
                            }}
                          />
                          <span className="absolute left-1 top-0.5 text-[9px] text-muted-foreground/70">Before</span>
                        </div>
                        {/* After timeline */}
                        <div className="relative h-4 bg-muted/30 rounded-sm overflow-hidden">
                          <div
                            className={`absolute h-full rounded-sm ${decision === 'reject' ? 'bg-muted-foreground/30' : 'bg-primary/50'}`}
                            style={{
                              left: `${getTimePosition(change.proposed_start)}%`,
                              width: `${getDurationWidth(change.proposed_start, change.proposed_end)}%`,
                            }}
                          />
                          <span className="absolute left-1 top-0.5 text-[9px] text-muted-foreground/70">After</span>
                        </div>
                      </div>

                      {/* Reasoning */}
                      <p className="text-xs text-muted-foreground/80 mt-3 italic">
                        "{change.reasoning}"
                      </p>
                    </div>

                    {/* Accept/Reject buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleDecision(change.event_id, 'accept')}
                        disabled={isApplying}
                        className={`p-2 rounded-lg transition-colors ${
                          decision === 'accept'
                            ? 'bg-green-500 text-white'
                            : 'bg-muted/50 text-muted-foreground hover:bg-green-500/20 hover:text-green-500'
                        }`}
                        title="Accept change"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleDecision(change.event_id, 'reject')}
                        disabled={isApplying}
                        className={`p-2 rounded-lg transition-colors ${
                          decision === 'reject'
                            ? 'bg-red-500 text-white'
                            : 'bg-muted/50 text-muted-foreground hover:bg-red-500/20 hover:text-red-500'
                        }`}
                        title="Reject change"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {proposedChanges.length > 0 && (
          <div className="p-6 border-t border-border/50 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={acceptAll}
                  disabled={isApplying}
                  className="px-4 py-2 text-sm font-medium text-green-500 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  Accept All ({proposedChanges.length})
                </button>
                <button
                  onClick={rejectAll}
                  disabled={isApplying}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 rounded-lg transition-colors disabled:opacity-50"
                >
                  Reject All
                </button>
              </div>

              <button
                onClick={handleApply}
                disabled={isApplying || acceptedCount === 0}
                className="px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isApplying
                  ? 'Applying...'
                  : acceptedCount > 0
                  ? `Apply ${acceptedCount} Change${acceptedCount > 1 ? 's' : ''}`
                  : 'Select Changes to Apply'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
