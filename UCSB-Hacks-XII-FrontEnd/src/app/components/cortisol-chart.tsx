import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

interface CortisolChartProps {
  data: { hour: string; level: number }[];
  color: string;
}

export function CortisolChart({ data, color }: CortisolChartProps) {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50">
      <h3 className="text-lg mb-4 text-foreground">Stress Curve (Today)</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <defs>
            <linearGradient id="cortisolGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, 100]} />
          <Line
            type="monotone"
            dataKey="level"
            stroke={color}
            strokeWidth={3}
            dot={false}
            fill="url(#cortisolGradient)"
            fillOpacity={1}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-xs text-muted-foreground mt-2">
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>12am</span>
      </div>
    </div>
  );
}
