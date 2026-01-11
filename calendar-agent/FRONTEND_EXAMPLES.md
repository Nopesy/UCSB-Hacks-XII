# Frontend API Examples

## Nap Times Endpoint

### Basic Usage (with defaults)
```typescript
// TypeScript/React example
const calculateNapTimes = async (date: string) => {
  try {
    const response = await fetch('http://localhost:5001/api/nap-times/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: date, // 'YYYY-MM-DD' format, e.g., '2026-01-15'
        user_id: 'default_user' // optional, defaults to 'default_user'
      })
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('Nap recommendations:', data.events);
      console.log('Summary:', data.summary);
      console.log('Count:', data.count);
      return data.events; // Array of suggested nap events
    } else {
      console.error('Error:', data.error);
      return [];
    }
  } catch (error) {
    console.error('Failed to calculate nap times:', error);
    return [];
  }
};

// Usage
const napEvents = await calculateNapTimes('2026-01-15');
```

### With Custom Sleep/Wake Times
```typescript
const calculateNapTimesWithSchedule = async (
  date: string,
  sleepTime: string = '23:00',
  wakeTime: string = '07:00'
) => {
  try {
    const response = await fetch('http://localhost:5001/api/nap-times/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: date,
        user_id: 'default_user',
        sleep_time: sleepTime, // 24-hour format 'HH:MM'
        wake_time: wakeTime    // 24-hour format 'HH:MM'
      })
    });

    const data = await response.json();
    return data.success ? data.events : [];
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
};

// Usage
const napEvents = await calculateNapTimesWithSchedule(
  '2026-01-15',
  '23:00', // 11 PM bedtime
  '07:00'  // 7 AM wake time
);
```

## Meal Windows Endpoint

### Basic Usage (with defaults)
```typescript
const calculateMealWindows = async (date: string) => {
  try {
    const response = await fetch('http://localhost:5001/api/meal-windows/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: date, // 'YYYY-MM-DD' format
        user_id: 'default_user' // optional
      })
    });

    const data = await response.json();
    
    if (data.success) {
      console.log('Meal recommendations:', data.events);
      console.log('Summary:', data.summary);
      return data.events; // Array of suggested meal events
    } else {
      console.error('Error:', data.error);
      return [];
    }
  } catch (error) {
    console.error('Failed to calculate meal windows:', error);
    return [];
  }
};

// Usage
const mealEvents = await calculateMealWindows('2026-01-15');
```

### With Custom Sleep/Wake Times
```typescript
const calculateMealWindowsWithSchedule = async (
  date: string,
  sleepTime: string = '23:00',
  wakeTime: string = '07:00'
) => {
  try {
    const response = await fetch('http://localhost:5001/api/meal-windows/calculate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        date: date,
        user_id: 'default_user',
        sleep_time: sleepTime,
        wake_time: wakeTime
      })
    });

    const data = await response.json();
    return data.success ? data.events : [];
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
};

// Usage
const mealEvents = await calculateMealWindowsWithSchedule(
  '2026-01-15',
  '22:30', // 10:30 PM bedtime
  '06:30'  // 6:30 AM wake time
);
```

## Combined Usage Example

### Get Both Nap Times and Meal Windows
```typescript
interface SchedulePreferences {
  sleepTime: string;
  wakeTime: string;
}

const getDailyScheduleRecommendations = async (
  date: string,
  preferences: SchedulePreferences
) => {
  try {
    // Call both endpoints in parallel
    const [napResponse, mealResponse] = await Promise.all([
      fetch('http://localhost:5001/api/nap-times/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          user_id: 'default_user',
          sleep_time: preferences.sleepTime,
          wake_time: preferences.wakeTime
        })
      }),
      fetch('http://localhost:5001/api/meal-windows/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          user_id: 'default_user',
          sleep_time: preferences.sleepTime,
          wake_time: preferences.wakeTime
        })
      })
    ]);

    const napData = await napResponse.json();
    const mealData = await mealResponse.json();

    return {
      naps: napData.success ? napData.events : [],
      meals: mealData.success ? mealData.events : [],
      napSummary: napData.summary || '',
      mealSummary: mealData.summary || ''
    };
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return { naps: [], meals: [], napSummary: '', mealSummary: '' };
  }
};

// Usage
const recommendations = await getDailyScheduleRecommendations('2026-01-15', {
  sleepTime: '23:00',
  wakeTime: '07:00'
});

console.log('Nap events:', recommendations.naps);
console.log('Meal events:', recommendations.meals);
```

## React Hook Example

```typescript
import { useState, useCallback } from 'react';

interface RecommendationEvent {
  kind: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  suggested: boolean;
  nap_type?: string;
  meal_type?: string;
  duration_minutes: number;
}

export const useScheduleRecommendations = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getNapTimes = useCallback(async (
    date: string,
    sleepTime?: string,
    wakeTime?: string
  ): Promise<RecommendationEvent[]> => {
    setLoading(true);
    setError(null);
    
    try {
      const body: any = { date, user_id: 'default_user' };
      if (sleepTime) body.sleep_time = sleepTime;
      if (wakeTime) body.wake_time = wakeTime;

      const response = await fetch('http://localhost:5001/api/nap-times/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      
      if (data.success) {
        return data.events;
      } else {
        setError(data.error || 'Failed to calculate nap times');
        return [];
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getMealWindows = useCallback(async (
    date: string,
    sleepTime?: string,
    wakeTime?: string
  ): Promise<RecommendationEvent[]> => {
    setLoading(true);
    setError(null);
    
    try {
      const body: any = { date, user_id: 'default_user' };
      if (sleepTime) body.sleep_time = sleepTime;
      if (wakeTime) body.wake_time = wakeTime;

      const response = await fetch('http://localhost:5001/api/meal-windows/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      
      if (data.success) {
        return data.events;
      } else {
        setError(data.error || 'Failed to calculate meal windows');
        return [];
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return { getNapTimes, getMealWindows, loading, error };
};

// Usage in a component
const MyComponent = () => {
  const { getNapTimes, getMealWindows, loading, error } = useScheduleRecommendations();

  const handleGetRecommendations = async () => {
    const date = '2026-01-15';
    const naps = await getNapTimes(date, '23:00', '07:00');
    const meals = await getMealWindows(date, '23:00', '07:00');
    
    // Combine and display in calendar
    const allSuggestions = [...naps, ...meals];
    console.log('All suggestions:', allSuggestions);
  };

  return (
    <div>
      <button onClick={handleGetRecommendations} disabled={loading}>
        {loading ? 'Loading...' : 'Get Recommendations'}
      </button>
      {error && <p>Error: {error}</p>}
    </div>
  );
};
```

## Response Format

Both endpoints return the same structure:

```typescript
interface ApiResponse {
  success: boolean;
  date: string;
  events: RecommendationEvent[];
  summary: string;
  count: number;
}

interface RecommendationEvent {
  kind: "calendar#event";
  summary: string; // "Power Nap", "Breakfast", etc.
  description: string;
  start: {
    dateTime: string; // ISO 8601 format
    timeZone: "America/Los_Angeles";
  };
  end: {
    dateTime: string;
    timeZone: "America/Los_Angeles";
  };
  colorId: string; // "10" for naps, "5" for meals
  transparency: "transparent";
  suggested: true;
  nap_type?: "power_nap" | "full_cycle"; // Only for nap events
  meal_type?: "breakfast" | "lunch" | "dinner" | "snack"; // Only for meal events
  duration_minutes: number;
}
```

## Error Handling

```typescript
const handleApiCall = async () => {
  try {
    const response = await fetch('http://localhost:5001/api/nap-times/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-01-15' })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      // Network error
      console.error('Network error - is the server running?');
    } else {
      // API error
      console.error('API error:', error);
    }
    throw error;
  }
};
```

## Adding Events to Calendar

Once the user selects which suggestions to keep, you can append them to your calendar:

```typescript
// Assuming you have existing calendar events
const addSuggestionsToCalendar = (
  existingEvents: any[],
  selectedSuggestions: RecommendationEvent[]
) => {
  // Remove 'suggested' flag to make them real events
  const confirmedEvents = selectedSuggestions.map(event => ({
    ...event,
    suggested: false // Remove suggested flag
  }));

  // Combine with existing events
  return [...existingEvents, ...confirmedEvents];
};

// Usage
const selectedNaps = napEvents.filter(nap => userSelectedNapIds.includes(nap.id));
const selectedMeals = mealEvents.filter(meal => userSelectedMealIds.includes(meal.id));
const allSelected = [...selectedNaps, ...selectedMeals];

const updatedCalendar = addSuggestionsToCalendar(existingCalendarEvents, allSelected);
```

