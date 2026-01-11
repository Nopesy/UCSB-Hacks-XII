import { useState, useRef, useCallback } from 'react';
import { Mic, Square, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const API_BASE_URL = 'http://localhost:5001';

interface TranscriptionResult {
  transcript: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentiment_score: number;
  summary: string;
}

interface BurnoutAdjustment {
  date: string;
  day_name: string;
  events: string[];
  old_score: number;
  new_score: number;
  adjustment: string;
}

interface MoodAnalysisResult {
  success: boolean;
  transcript: string;
  sentiment: string;
  is_stressed: boolean;
  matched_events: { event_id: string; title: string; date: string; day_name: string }[];
  burnout_adjustments: BurnoutAdjustment[];
  message: string;
}

type RecordingState = 'idle' | 'recording' | 'processing' | 'complete' | 'error';

interface VoiceCheckInProps {
  onBurnoutUpdated?: () => void;
}

export function VoiceCheckIn({ onBurnoutUpdated }: VoiceCheckInProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [moodAnalysis, setMoodAnalysis] = useState<MoodAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscription(null);
      setMoodAnalysis(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Use webm with opus for better compression
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        // Process the recording
        await processRecording();
      };

      mediaRecorder.start(1000); // Collect data every second
      setRecordingState('recording');
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Could not access microphone. Please allow microphone access.');
      setRecordingState('error');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecordingState('processing');
    }
  }, [recordingState]);

  const processRecording = async () => {
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

      // Convert to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = reader.result as string;
          resolve(base64);
        };
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await base64Promise;

      console.log(`[VoiceCheckIn] Sending audio (${audioBlob.size} bytes) to transcription API`);

      // Send to transcription API
      const transcribeResponse = await fetch(`${API_BASE_URL}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: base64Audio,
          user_id: 'default_user',
          mimetype: 'audio/webm'
        })
      });

      const transcribeData = await transcribeResponse.json();

      if (!transcribeResponse.ok) {
        throw new Error(transcribeData.error || 'Transcription failed');
      }

      console.log('[VoiceCheckIn] Transcription result:', transcribeData);
      setTranscription({
        transcript: transcribeData.transcript,
        sentiment: transcribeData.sentiment,
        sentiment_score: transcribeData.sentiment_score,
        summary: transcribeData.summary
      });

      // Now analyze mood and update burnout
      console.log('[VoiceCheckIn] Analyzing mood and updating burnout...');
      const moodResponse = await fetch(`${API_BASE_URL}/api/voice/analyze-mood`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'default_user'
        })
      });

      const moodData = await moodResponse.json();

      if (moodResponse.ok && moodData.success) {
        console.log('[VoiceCheckIn] Mood analysis result:', moodData);
        setMoodAnalysis(moodData);

        // Notify parent to refresh burnout data if adjustments were made
        if (moodData.burnout_adjustments && moodData.burnout_adjustments.length > 0 && onBurnoutUpdated) {
          console.log('[VoiceCheckIn] Burnout adjustments made, notifying parent to refresh');
          onBurnoutUpdated();
        }
      }

      setRecordingState('complete');

    } catch (err) {
      console.error('Error processing recording:', err);
      setError(err instanceof Error ? err.message : 'Failed to process recording');
      setRecordingState('error');
    }
  };

  const reset = () => {
    setRecordingState('idle');
    setTranscription(null);
    setMoodAnalysis(null);
    setError(null);
    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return 'text-green-500';
      case 'negative': return 'text-red-500';
      default: return 'text-yellow-500';
    }
  };

  const getSentimentEmoji = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return '😊';
      case 'negative': return '😔';
      default: return '😐';
    }
  };

  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm border border-border/50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg text-foreground">Voice Check-In</h3>
        <span className="text-xs text-muted-foreground">Optional</span>
      </div>

      {recordingState === 'idle' && (
        <>
          <p className="text-sm text-muted-foreground mb-6">
            Share how you're feeling. We'll analyze your voice for stress markers and adjust your burnout prediction.
          </p>

          <button
            onClick={startRecording}
            className="w-full bg-primary text-primary-foreground py-4 rounded-xl hover:bg-primary/90 transition-all flex items-center justify-center gap-3 group"
          >
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Mic className="w-5 h-5 text-white" />
            </div>
            <span className="font-medium">Start Recording</span>
          </button>
        </>
      )}

      {recordingState === 'recording' && (
        <>
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 text-red-500 mb-2">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="font-medium">Recording...</span>
            </div>
            <div className="text-2xl font-mono text-foreground">{formatTime(recordingTime)}</div>
          </div>

          <p className="text-sm text-muted-foreground mb-6 text-center">
            Tell us how you're feeling today. Mention if you're tired, stressed, or anything on your mind.
          </p>

          <button
            onClick={stopRecording}
            className="w-full bg-red-500 text-white py-4 rounded-xl hover:bg-red-600 transition-all flex items-center justify-center gap-3"
          >
            <Square className="w-5 h-5" fill="white" />
            <span className="font-medium">Stop Recording</span>
          </button>
        </>
      )}

      {recordingState === 'processing' && (
        <div className="text-center py-8">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Analyzing your voice check-in...
          </p>
        </div>
      )}

      {recordingState === 'complete' && transcription && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-500 mb-2">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Check-in Complete</span>
          </div>

          {/* Transcript */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-xs text-muted-foreground mb-1">What you said:</div>
            <p className="text-sm text-foreground">"{transcription.transcript || 'No speech detected'}"</p>
          </div>

          {/* Sentiment */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-xs text-muted-foreground mb-1">Detected Mood</div>
            <div className={`text-lg font-medium flex items-center gap-2 ${getSentimentColor(transcription.sentiment)}`}>
              <span>{getSentimentEmoji(transcription.sentiment)}</span>
              <span className="capitalize">{transcription.sentiment}</span>
            </div>
          </div>

          {/* Burnout Adjustments - show if any events were matched */}
          {moodAnalysis && moodAnalysis.burnout_adjustments && moodAnalysis.burnout_adjustments.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <div className="text-xs text-red-400 mb-2">Stress detected - Updated burnout scores:</div>
              <div className="space-y-2">
                {moodAnalysis.burnout_adjustments.map((adj, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-foreground">{adj.day_name}</span>
                      <span className="text-muted-foreground ml-2">({adj.events[0]})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{adj.old_score}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-red-400 font-medium">{adj.new_score}</span>
                      <span className="text-red-400 text-xs">({adj.adjustment})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Message if no stress/events detected */}
          {moodAnalysis && (!moodAnalysis.burnout_adjustments || moodAnalysis.burnout_adjustments.length === 0) && (
            <div className="text-xs text-muted-foreground text-center">
              {moodAnalysis.message || "No specific event stress detected"}
            </div>
          )}

          <button
            onClick={reset}
            className="w-full bg-muted text-foreground py-3 rounded-xl hover:bg-muted/80 transition-all text-sm"
          >
            Record Another Check-In
          </button>
        </div>
      )}

      {recordingState === 'error' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Error</span>
          </div>

          <p className="text-sm text-muted-foreground">{error}</p>

          <button
            onClick={reset}
            className="w-full bg-muted text-foreground py-3 rounded-xl hover:bg-muted/80 transition-all text-sm"
          >
            Try Again
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
        <span>Your data stays private</span>
      </div>
    </div>
  );
}
