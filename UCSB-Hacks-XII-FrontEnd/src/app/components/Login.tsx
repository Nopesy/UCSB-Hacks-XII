import * as React from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulate auth delay
    setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 600);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl p-6 shadow-md border border-border/50">
          <h2 className="text-2xl font-semibold text-foreground mb-1">Sign in</h2>
          <p className="text-sm text-muted-foreground mb-6">Enter your work email to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-2">Email</label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                aria-label="Email"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-2">Password</label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                aria-label="Password"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </div>

            <div className="text-center mt-2">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-2"
                onClick={() => {
                  // convenience: fill demo credentials
                  setEmail('demo@company.com');
                  setPassword('password');
                }}
              >
                Use demo credentials
              </button>
            </div>
          </form>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-4">By signing in you agree to your organization's policies.</p>
      </div>
    </div>
  );
}
