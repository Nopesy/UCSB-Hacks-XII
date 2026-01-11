interface MetricProps {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'stable';
  icon: React.ReactNode;
}

function Metric({ label, value, trend, icon }: MetricProps) {
  const trendColors = {
    up: '#fb7185',
    down: '#10b981',
    stable: '#64748b',
  };

  return (
    <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl">
      <div className="text-muted-foreground">{icon}</div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold text-foreground">{value}</p>
      </div>
      {trend && (
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: trendColors[trend] }} />
      )}
    </div>
  );
}

interface BurnoutMetricsProps {
  sleep: string;
  assignments: string;
  avgStress: string;
}

export function BurnoutMetrics({ sleep, assignments, avgStress }: BurnoutMetricsProps) {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50 space-y-3">
      <h3 className="text-lg mb-4 text-foreground">This Week</h3>
      
      <Metric
        label="Avg Sleep"
        value={sleep}
        trend="down"
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        }
      />
      
      <Metric
        label="Assignments Due"
        value={assignments}
        trend="up"
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            <rect width="20" height="14" x="2" y="6" rx="2" />
          </svg>
        }
      />
      
      <Metric
        label="Avg Stress Level"
        value={avgStress}
        trend="up"
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        }
      />
    </div>
  );
}
