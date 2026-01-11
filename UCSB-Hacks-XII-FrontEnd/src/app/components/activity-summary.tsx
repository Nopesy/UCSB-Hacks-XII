import { Moon, Calendar, BookOpen } from 'lucide-react';

interface ActivityItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
}

function ActivityItem({ icon, label, value, sublabel }: ActivityItemProps) {
  return (
    <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-xl">
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-sm text-foreground font-medium">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </div>
      <div className="text-right">
        <p className="text-lg font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

export function ActivitySummary() {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50 space-y-3">
      <h3 className="text-lg mb-4 text-foreground">Today's Activity</h3>
      
      <ActivityItem
        icon={<Moon className="w-5 h-5" />}
        label="Sleep"
        sublabel="Last night"
        value="4.5h"
      />
      
      <ActivityItem
        icon={<Calendar className="w-5 h-5" />}
        label="Calendar"
        sublabel="Events today"
        value="6"
      />
      
      <ActivityItem
        icon={<BookOpen className="w-5 h-5" />}
        label="Assignments"
        sublabel="Due this week"
        value="3"
      />
    </div>
  );
}
