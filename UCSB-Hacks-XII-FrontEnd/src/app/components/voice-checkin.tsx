import { Mic } from 'lucide-react';

export function VoiceCheckIn() {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg text-foreground">Voice Check-In</h3>
        <span className="text-xs text-muted-foreground">Optional</span>
      </div>
      
      <p className="text-sm text-muted-foreground mb-6">
        Share how you're feeling. We'll analyze your voice for stress markers.
      </p>
      
      <button className="w-full bg-secondary/10 border-2 border-secondary/30 text-secondary py-4 rounded-xl hover:bg-secondary/20 transition-all flex items-center justify-center gap-3 group">
        <div className="w-12 h-12 rounded-full bg-secondary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
          <Mic className="w-5 h-5 text-secondary" />
        </div>
        <span className="font-medium">Start Recording</span>
      </button>
      
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
        <span>Your data stays private</span>
      </div>
    </div>
  );
}
