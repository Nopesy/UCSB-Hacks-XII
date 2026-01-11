"""
Calendar Agent using Google AI SDK directly
No LangChain dependency
"""

import os
import json
from datetime import datetime, timedelta
from google import genai
from google.genai import types
from calendar_tools import get_calendar_tool_instance
import requests
import time


# Initialize calendar lazily (only when needed)
calendar = None

def get_calendar():
    """Get calendar instance, initializing it lazily if needed"""
    global calendar
    if calendar is None:
        try:
            calendar = get_calendar_tool_instance()
        except FileNotFoundError:
            # Calendar tool not available (no token.json) - that's okay for API server
            calendar = None
    return calendar


def _try_rest_api_fallback(api_key: str, prompt: str, last_error: Exception = None) -> str:
    """Fallback to REST API when SDK models fail"""
    # Try models that have available quota (with correct model names)
    rest_models = [
        'gemini-3-flash-preview',  # Has quota
        'gemini-2.0-flash-lite',  # Alternative model
        'gemma-3-12b-it',  # Has quota
        'gemma-3-4b-it',  # Has quota
        'gemini-2.5-flash',  # May be at limit
    ]
    
    url_template = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
    
    for model in rest_models:
        try:
            url = url_template.format(model=model, key=api_key)
            payload = {
                "contents": [{
                    "parts": [{"text": prompt}]
                }]
            }
            
            response = requests.post(url, json=payload, timeout=60)
            
            if response.status_code == 200:
                result = response.json()
                if 'candidates' in result and len(result['candidates']) > 0:
                    content = result['candidates'][0].get('content', {})
                    parts = content.get('parts', [])
                    if parts and 'text' in parts[0]:
                        print(f"✅ REST API fallback succeeded with {model}", flush=True)
                        return parts[0]['text']
            elif response.status_code == 429:
                print(f"⚠️  REST API model {model} quota exceeded, trying next...", flush=True)
                continue
            else:
                print(f"⚠️  REST API model {model} failed: {response.status_code}, trying next...", flush=True)
                continue
                
        except Exception as e:
            print(f"⚠️  REST API model {model} error: {str(e)[:100]}, trying next...", flush=True)
            continue
    
    return None


# System prompt with ATUS insights
SYSTEM_PROMPT = """You are a helpful calendar assistant with expertise in schedule optimization.

IMPORTANT: User is in Pacific Time (America/Los_Angeles). When creating events, convert all times to Pacific Time and use ISO format 'YYYY-MM-DDTHH:MM:SS' without timezone suffix (times will be interpreted as local Pacific Time).

EVIDENCE-BASED SCHEDULING INSIGHTS (ATUS 2024 data - 7,669 Americans):
- Optimal sleep: 7-8 hours (people with <6 hours report 65% higher sadness)
- Fragmented sleep increases tiredness by 63%
- Exercise correlates with better well-being (but most people only get 0.02 hrs/day!)
- Social activities improve mood

When helping users:
1. Protect sleep time (7-8 hours)
2. Suggest exercise in mornings/afternoons
3. Leave buffer time between events
4. Balance work, social, and personal time

Be concise and helpful. Use the calendar tools to assist users."""


# Define tool functions for Gemini
def get_calendar_events_tool(days_ahead: int = 7) -> str:
    """Get upcoming events from Google Calendar

    Args:
        days_ahead: Number of days ahead to look (default 7)
    """
    cal = get_calendar()
    if not cal:
        return "Calendar not available. Please authenticate first."
    events = cal.get_events(days_ahead=days_ahead)

    if not events:
        return "No upcoming events found."

    result = f"Found {len(events)} upcoming events:\n\n"
    for i, event in enumerate(events, 1):
        result += f"{i}. {event['title']}\n"
        result += f"   Start: {event['start']}\n"
        result += f"   End: {event['end']}\n"
        if event['description']:
            result += f"   Description: {event['description']}\n"
        result += "\n"

    return result


def create_calendar_event_tool(title: str, start_time: str, duration_minutes: int = 60,
                                description: str = "", location: str = "") -> str:
    """Create a new event in Google Calendar

    Args:
        title: Event title
        start_time: Start time in ISO format 'YYYY-MM-DDTHH:MM:SS' (e.g. '2026-01-11T14:00:00')
        duration_minutes: Duration in minutes (default 60)
        description: Event description (optional)
        location: Event location (optional)
    """
    start_dt = datetime.fromisoformat(start_time)

    cal = get_calendar()
    if not cal:
        return "❌ Calendar not available. Please authenticate first."
    result = cal.create_event(
        title=title,
        start_time=start_dt,
        duration_minutes=duration_minutes,
        description=description,
        location=location
    )

    if result:
        return f"✅ Created event '{result['title']}' at {result['start']}\nLink: {result.get('link', 'N/A')}"
    else:
        return "❌ Failed to create event"


def find_free_time_tool(date_str: str, duration_minutes: int = 30) -> str:
    """Find free time slots on a given date

    Args:
        date_str: Date to search in ISO format 'YYYY-MM-DD' (e.g., '2026-01-11')
        duration_minutes: Required duration in minutes (default 30)
    """
    date = datetime.fromisoformat(date_str)
    cal = get_calendar()
    if not cal:
        return f"Calendar not available. Please authenticate first."
    free_slots = cal.find_free_slots(date, duration_minutes)

    if not free_slots:
        return f"No free {duration_minutes}-minute slots found on {date.strftime('%Y-%m-%d')}"

    result = f"Free {duration_minutes}-minute slots on {date.strftime('%Y-%m-%d')}:\n\n"
    for i, (start, end) in enumerate(free_slots[:5], 1):
        result += f"{i}. {start.strftime('%H:%M')} - {end.strftime('%H:%M')}\n"

    return result


def fetch_events_from_node_api(user_id: str, start_date: str, end_date: str, node_url: str = None):
    """Fetch events for a user and date range from the Node API."""
    if node_url is None:
        node_url = os.environ.get('NODE_API_URL', 'http://localhost:3001')
    try:
        params = {
            'user_id': user_id,
            'start': start_date,
            'end': end_date,
            'limit': 1000
        }
        resp = requests.get(f"{node_url}/api/events", params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return data.get('events', [])
    except Exception as e:
        print(f"Error fetching events from Node API: {e}", flush=True)
        return []


def calculate_nap_time_tool(date_str: str, user_id: str = 'default_user', 
                            sleep_time: str = '00:00', wake_time: str = '08:00',
                            provided_events: list = None) -> str:
    """Calculate optimal nap times and windows for a given day using Gemini AI
    
    Analyzes the calendar for the specified date and uses Gemini AI to recommend 
    best nap windows based on the user's schedule and sleep science principles.

    Args:
        date_str: Date to analyze in ISO format 'YYYY-MM-DD' (e.g., '2026-01-11')
        user_id: User ID to load calendar data for (default: 'default_user')
        sleep_time: Bedtime in 24-hour format 'HH:MM' (default: '00:00' for midnight)
        wake_time: Wake time in 24-hour format 'HH:MM' (default: '08:00' for 8 AM)
    """
    try:
        target_date = datetime.fromisoformat(date_str).date()
        today = datetime.now().date()
        
        # Calculate days ahead needed to reach target date
        days_diff = (target_date - today).days
        if days_diff < 0:
            return json.dumps({"error": f"The date {date_str} is in the past. Please provide today's date or a future date."})
        if days_diff > 7:
            return json.dumps({"error": f"Date is more than 7 days away. Please provide a date within the next week."})
        
        # Require events from MongoDB via Node.js API
        if not provided_events:
            return json.dumps({"error": "Events must be provided from MongoDB via Node.js API. No fallback to JSON files."})
        
        # Events provided from MongoDB via Node.js API
        all_events = provided_events
        
        day_events = []
        for event in all_events:
            # Try to parse start time from normalized or raw fields
            startISO = event.get('startISO')
            if not startISO and 'raw' in event:
                raw = event['raw']
                startISO = raw.get('start', {}).get('dateTime') or raw.get('start', {}).get('date')
            if startISO:
                try:
                    dt_str = startISO
                    if dt_str.endswith('Z'):
                        dt_str = dt_str[:-1] + '+00:00'
                    event_dt = datetime.fromisoformat(dt_str)
                    if event_dt.tzinfo:
                        event_dt = event_dt.astimezone().replace(tzinfo=None)
                    if event_dt.date() == target_date:
                        # Parse end time - handle both MongoDB format and Google Calendar format
                        endISO = event.get('endISO')
                        if not endISO:
                            # Try Google Calendar format
                            if isinstance(event.get('end'), dict):
                                endISO = event.get('end', {}).get('dateTime') or event.get('end', {}).get('date')
                            elif 'raw' in event:
                                raw = event['raw']
                                endISO = raw.get('end', {}).get('dateTime') if isinstance(raw.get('end'), dict) else raw.get('end')
                        
                        if endISO:
                            if isinstance(endISO, str):
                                if endISO.endswith('Z'):
                                    endISO = endISO[:-1] + '+00:00'
                                event_end = datetime.fromisoformat(endISO)
                                if event_end.tzinfo:
                                    event_end = event_end.astimezone().replace(tzinfo=None)
                            else:
                                event_end = event_dt + timedelta(hours=1)
                        else:
                            event_end = event_dt + timedelta(hours=1)
                        
                        day_events.append({
                            'title': event.get('title') or event.get('summary', 'Event'),
                            'start': event_dt,
                            'end': event_end,
                            'description': event.get('description', '')
                        })
                except Exception as e:
                    continue
        
        # Sort events by start time
        day_events.sort(key=lambda x: x['start'])
        
        # Format schedule for Gemini prompt
        schedule_text = ""
        if day_events:
            schedule_text = f"\n\n📅 SCHEDULE FOR {target_date.strftime('%A, %B %d, %Y')}:\n\n"
            for event in day_events:
                start_time = event['start'].strftime('%I:%M %p')
                end_time = event['end'].strftime('%I:%M %p')
                schedule_text += f"• {start_time} - {end_time}: {event['title']}\n"
                if event.get('description'):
                    desc = event['description'][:80] + '...' if len(event['description']) > 80 else event['description']
                    schedule_text += f"  Description: {desc}\n"
        else:
            schedule_text = f"\n\n📅 SCHEDULE FOR {target_date.strftime('%A, %B %d, %Y')}:\nNo events scheduled for this day.\n"
        
        # Calculate free time slots from day_events
        free_slots_30 = []
        free_slots_90 = []
        
        # Day starts at 8 AM and ends at 10 PM for nap calculations
        day_start = datetime.combine(target_date, datetime.min.time().replace(hour=8, minute=0))
        day_end = datetime.combine(target_date, datetime.min.time().replace(hour=22, minute=0))
        
        if day_events:
            # Find gaps between events
            current_time = day_start
            for event in day_events:
                event_start = event['start']
                if event_start > current_time:
                    # Found a gap
                    gap_duration = (event_start - current_time).total_seconds() / 60
                    if gap_duration >= 30:
                        free_slots_30.append((current_time, event_start))
                    if gap_duration >= 90:
                        free_slots_90.append((current_time, event_start))
                # Update current_time to end of this event
                current_time = max(current_time, event['end'])
            
            # Check gap after last event
            if current_time < day_end:
                gap_duration = (day_end - current_time).total_seconds() / 60
                if gap_duration >= 30:
                    free_slots_30.append((current_time, day_end))
                if gap_duration >= 90:
                    free_slots_90.append((current_time, day_end))
        else:
            # No events - whole day is free
            free_slots_30.append((day_start, day_end))
            free_slots_90.append((day_start, day_end))
        
        # Free slots calculated from provided events only - no calendar tool fallback
        
        # Format free slots
        free_slots_text = "\n\n⏰ AVAILABLE FREE TIME SLOTS:\n\n"
        if free_slots_30 or free_slots_90:
            free_slots_text += "30-minute slots (for power naps):\n"
            for start, end in free_slots_30[:10]:
                if start.date() == target_date:
                    free_slots_text += f"  • {start.strftime('%I:%M %p')} - {end.strftime('%I:%M %p')}\n"
            
            free_slots_text += "\n90-minute slots (for full cycle naps):\n"
            for start, end in free_slots_90[:10]:
                if start.date() == target_date:
                    free_slots_text += f"  • {start.strftime('%I:%M %p')} - {end.strftime('%I:%M %p')}\n"
        else:
            free_slots_text += "No significant free time slots found.\n"
        
        # Parse sleep and wake times
        try:
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            sleep_time_obj = datetime.min.time().replace(hour=sleep_hour, minute=sleep_minute)
            wake_time_obj = datetime.min.time().replace(hour=wake_hour, minute=wake_minute)
        except (ValueError, AttributeError):
            # Default to midnight and 8 AM if parsing fails
            sleep_time_obj = datetime.min.time().replace(hour=0, minute=0)
            wake_time_obj = datetime.min.time().replace(hour=8, minute=0)
        
        sleep_time_str = sleep_time_obj.strftime('%I:%M %p')
        wake_time_str = wake_time_obj.strftime('%I:%M %p')
        
        # Calculate latest nap time (6-8 hours before bedtime)
        sleep_dt = datetime.combine(target_date, sleep_time_obj)
        latest_nap_end = sleep_dt - timedelta(hours=6)  # 6 hours before bedtime
        latest_nap_time_str = latest_nap_end.strftime('%I:%M %p')
        
        # Build comprehensive prompt for Gemini
        nap_prompt = f"""You are a sleep science expert helping someone plan optimal nap times for their day.

{schedule_text}

{free_slots_text}

😴 USER'S SLEEP SCHEDULE:
- Bedtime: {sleep_time_str}
- Wake time: {wake_time_str}
- Latest recommended nap end time: {latest_nap_time_str} (to avoid disrupting nighttime sleep)

🧠 SLEEP SCIENCE PRINCIPLES FOR OPTIMAL NAPPING:

1. **Power Naps (20-30 minutes)**:
   - Best for quick energy boost and alertness
   - Prevents entering deep sleep (avoid sleep inertia)
   - Ideal timing: 1:00 PM - 3:00 PM (afternoon dip in circadian rhythm)
   - Should end before 3:00 PM to avoid interfering with nighttime sleep

2. **Full Cycle Naps (90 minutes)**:
   - Complete one full sleep cycle (includes REM sleep)
   - Provides deeper rest and cognitive benefits
   - Ideal timing: 1:00 PM - 2:30 PM (earlier is better)
   - Should end before 3:00 PM to avoid affecting nighttime sleep

3. **Timing Guidelines**:
   - Optimal window: 1:00 PM - 3:00 PM (aligns with natural afternoon energy dip)
   - CRITICAL: User's bedtime is {sleep_time_str} - naps must end by {latest_nap_time_str} (at least 6 hours before bedtime) to avoid disrupting nighttime sleep
   - If user has an early bedtime, adjust recommendations accordingly
   - Consider buffer time before/after important events
   - Account for time needed to wake up and become alert

4. **Context Considerations**:
   - Consider the intensity of events before/after potential nap times
   - Leave buffer time if user has important meetings or activities
   - Consider energy levels throughout the day
   - Factor in commute or preparation time if needed

**CRITICAL CONSTRAINT - NO OVERLAPS**:
   - You MUST ONLY schedule naps within the free time slots provided above
   - Do NOT schedule any nap that overlaps with an existing calendar event
   - The free time slots listed above are the ONLY valid times for nap recommendations
   - If no suitable free slots exist, explain this in the summary rather than creating conflicting recommendations

**TASK**: Based on the user's schedule above and the available free time slots, provide personalized nap recommendations for {target_date.strftime('%A, %B %d, %Y')}.

**IMPORTANT**: You MUST return ONLY valid JSON in this exact format (no markdown, no code blocks, just pure JSON):

{{
  "recommendations": [
    {{
      "type": "power_nap" or "full_cycle",
      "title": "Power Nap" or "Full Cycle Nap",
      "start_time": "HH:MM" (24-hour format, e.g., "13:30"),
      "duration_minutes": 30 or 90,
      "reasoning": "Brief explanation of why this time works best",
      "priority_score": 1-10 (higher is better, based on optimal timing and schedule fit)
    }}
  ],
  "summary": "Brief overall explanation of recommendations"
}}

Return EXACTLY 2 best nap recommendations total (can be mix of power nap and full cycle, choose the 2 most optimal times). Prioritize times in the 1:00 PM - 3:00 PM window. All times should be in 24-hour format (HH:MM)."""
        
        # Get API key and set up Gemini client
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        
        if not api_key:
            return json.dumps({"error": "GOOGLE_API_KEY or GEMINI_API_KEY not found"})
        
        # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key
        
        # Create Gemini client
        client = genai.Client()
        
        # List of models to try (prioritize models with available quota)
        # Note: gemma models need -it suffix for instruction-tuned versions
        models_to_try = [
            'gemini-3-flash-preview',  # Has quota available
            'gemini-2.0-flash-lite',  # Alternative flash model
            'gemma-3-12b-it',  # 0/30 RPM (has quota!)
            'gemma-3-27b-it',  # 0/30 RPM (has quota!)
            'gemma-3-4b-it',  # 0/30 RPM (has quota!)
            'gemma-3-1b-it',  # 0/30 RPM (has quota!)
            'gemini-2.5-flash',  # May be at quota limit
            'gemini-2.5-flash-lite',  # May be over quota limit
        ]
        
        last_error = None
        gemini_response = None
        
        for model in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=nap_prompt,
                )
                gemini_response = response.text
                break

            except Exception as e:
                error_str = str(e)
                # If it's a quota error, wait a bit and retry once
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    print(f"Model {model} quota exceeded, waiting 2 seconds and retrying...", flush=True)
                    time.sleep(2)
                    try:
                        response = client.models.generate_content(
                            model=model,
                            contents=nap_prompt,
                        )
                        gemini_response = response.text
                        break
                    except Exception as e2:
                        last_error = e2
                        print(f"Model {model} still failed after retry: {str(e2)[:200]}, trying next model...", flush=True)
                        continue
                # If it's a model not found error, try next model
                elif '404' in error_str or 'NOT_FOUND' in error_str:
                    last_error = e
                    print(f"Model {model} not found: {error_str[:200]}, trying next model...", flush=True)
                    continue
                # If it's not a recoverable error, raise it immediately
                else:
                    raise

        # If all SDK models failed, try REST API as fallback
        if not gemini_response:
            print("All SDK models failed, trying REST API fallback...", flush=True)
            gemini_response = _try_rest_api_fallback(api_key, nap_prompt, last_error)
        
        if not gemini_response:
            raise Exception(f"All models exhausted (SDK and REST API). Last error: {last_error}")
        
        # Parse Gemini's JSON response
        try:
            # Clean up the response - remove markdown code blocks if present
            cleaned_response = gemini_response.strip()
            if cleaned_response.startswith('```json'):
                cleaned_response = cleaned_response[7:]
            elif cleaned_response.startswith('```'):
                cleaned_response = cleaned_response[3:]
            if cleaned_response.endswith('```'):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()
            
            recommendations_data = json.loads(cleaned_response)
            
            # Convert recommendations to calendar event format
            calendar_events = []
            recommendations = recommendations_data.get('recommendations', [])
            
            # Sort by priority_score if available, otherwise keep order
            if recommendations and 'priority_score' in recommendations[0]:
                recommendations.sort(key=lambda x: x.get('priority_score', 0), reverse=True)
            
            # Limit to top 2 best recommendations
            recommendations = recommendations[:2]
            
            for rec in recommendations:
                start_time_str = rec.get('start_time', '')
                duration = rec.get('duration_minutes', 30)
                nap_type = rec.get('type', 'power_nap')
                title = rec.get('title', 'Power Nap' if nap_type == 'power_nap' else 'Full Cycle Nap')
                reasoning = rec.get('reasoning', '')
                
                # Parse time and create datetime objects
                try:
                    hour, minute = map(int, start_time_str.split(':'))
                    start_dt = datetime.combine(target_date, datetime.min.time().replace(hour=hour, minute=minute))
                    end_dt = start_dt + timedelta(minutes=duration)
                    
                    # Format as ISO 8601 with timezone (Pacific Time)
                    start_iso = start_dt.strftime('%Y-%m-%dT%H:%M:%S-08:00')
                    end_iso = end_dt.strftime('%Y-%m-%dT%H:%M:%S-08:00')
                    
                    # Create calendar event in Google Calendar format
                    # These are suggested events for frontend display - user will choose which to keep
                    calendar_event = {
                        "kind": "calendar#event",
                        "summary": title,
                        "description": f"Recommended {title.lower()}. {reasoning}",
                        "start": {
                            "dateTime": start_iso,
                            "timeZone": "America/Los_Angeles"
                        },
                        "end": {
                            "dateTime": end_iso,
                            "timeZone": "America/Los_Angeles"
                        },
                        "colorId": "10",  # Light blue color for naps
                        "transparency": "transparent",  # Show as free/busy
                        "suggested": True,  # Flag to indicate this is a suggested event
                        "nap_type": nap_type,  # "power_nap" or "full_cycle"
                        "duration_minutes": duration
                    }
                    
                    calendar_events.append(calendar_event)
                    
                except (ValueError, AttributeError) as e:
                    # Skip invalid time formats
                    continue
            
            # Return JSON array of calendar events
            return json.dumps({
                "events": calendar_events,
                "summary": recommendations_data.get('summary', ''),
                "count": len(calendar_events)
            }, indent=2)
            
        except json.JSONDecodeError as e:
            # If JSON parsing fails, return error with raw response for debugging
            return json.dumps({
                "error": "Failed to parse Gemini response as JSON",
                "raw_response": gemini_response[:500],  # First 500 chars for debugging
                "parse_error": str(e)
            })
        
    except Exception as e:
        return json.dumps({"error": f"Error calculating nap times: {str(e)}"})


def calculate_meal_windows_tool(date_str: str, user_id: str = 'default_user', 
                                sleep_time: str = '00:00', wake_time: str = '08:00',
                                provided_events: list = None) -> str:
    """Calculate optimal meal windows for a given day using Gemini AI
    
    Analyzes the calendar for the specified date and uses Gemini AI to recommend 
    best meal times based on the user's schedule, sleep/wake times, and nutrition science.

    Args:
        date_str: Date to analyze in ISO format 'YYYY-MM-DD' (e.g., '2026-01-11')
        user_id: User ID to load calendar data for (default: 'default_user')
        sleep_time: Bedtime in 24-hour format 'HH:MM' (default: '00:00' for midnight)
        wake_time: Wake time in 24-hour format 'HH:MM' (default: '08:00' for 8 AM)
    """
    try:
        target_date = datetime.fromisoformat(date_str).date()
        today = datetime.now().date()
        
        # Calculate days ahead needed to reach target date
        days_diff = (target_date - today).days
        if days_diff < 0:
            return json.dumps({"error": f"The date {date_str} is in the past. Please provide today's date or a future date."})
        if days_diff > 7:
            return json.dumps({"error": f"Date is more than 7 days away. Please provide a date within the next week."})
        
        # Require events from MongoDB via Node.js API
        if not provided_events:
            return json.dumps({"error": "Events must be provided from MongoDB via Node.js API. No fallback to JSON files."})
        
        # Events provided from MongoDB via Node.js API
        all_events = provided_events
        day_events = []
        
        # Filter events for the target date (works for both MongoDB and JSON formats)
        for event in all_events:
            # Handle multiple timestamp formats: startTs (MongoDB), startISO, start.dateTime (Google Calendar)
            startISO = event.get('startTs') or event.get('startISO')
            if not startISO:
                start_data = event.get('start', {})
                if isinstance(start_data, dict):
                    startISO = start_data.get('dateTime') or start_data.get('date')
                else:
                    startISO = str(start_data) if start_data else None
            
            if startISO:
                try:
                    # Handle timezone formats
                    dt_str = startISO
                    if dt_str.endswith('Z'):
                        dt_str = dt_str[:-1] + '+00:00'
                    event_dt = datetime.fromisoformat(dt_str)
                    if event_dt.tzinfo:
                        event_dt = event_dt.astimezone().replace(tzinfo=None)
                    
                    # Check if event is on target date
                    if event_dt.date() == target_date:
                        # Parse end time - handle multiple formats: endTs (MongoDB), endISO, end.dateTime
                        endISO = event.get('endTs') or event.get('endISO')
                        if not endISO:
                            end_data = event.get('end', {})
                            if isinstance(end_data, dict):
                                endISO = end_data.get('dateTime') or end_data.get('date')
                            else:
                                endISO = str(end_data) if end_data else None
                        
                        if endISO:
                            if isinstance(endISO, str):
                                if endISO.endswith('Z'):
                                    endISO = endISO[:-1] + '+00:00'
                                event_end = datetime.fromisoformat(endISO)
                                if event_end.tzinfo:
                                    event_end = event_end.astimezone().replace(tzinfo=None)
                            else:
                                event_end = event_dt + timedelta(hours=1)
                        else:
                            event_end = event_dt + timedelta(hours=1)
                        
                        day_events.append({
                            'title': event.get('title') or event.get('summary', 'Event'),
                            'start': event_dt,
                            'end': event_end,
                            'description': event.get('description', '')
                        })
                except (ValueError, AttributeError):
                    continue
        
        # Events must come from MongoDB via Node.js API - no calendar tool fallback
        
        # Sort events by start time
        day_events.sort(key=lambda x: x['start'])
        
        # Format schedule for Gemini prompt
        schedule_text = ""
        if day_events:
            schedule_text = f"\n\n📅 SCHEDULE FOR {target_date.strftime('%A, %B %d, %Y')}:\n\n"
            for event in day_events:
                start_time = event['start'].strftime('%I:%M %p')
                end_time = event['end'].strftime('%I:%M %p')
                schedule_text += f"• {start_time} - {end_time}: {event['title']}\n"
                if event.get('description'):
                    desc = event['description'][:80] + '...' if len(event['description']) > 80 else event['description']
                    schedule_text += f"  Description: {desc}\n"
        else:
            schedule_text = f"\n\n📅 SCHEDULE FOR {target_date.strftime('%A, %B %d, %Y')}:\nNo events scheduled for this day.\n"
        
        # Parse sleep and wake times
        try:
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            sleep_time_obj = datetime.min.time().replace(hour=sleep_hour, minute=sleep_minute)
            wake_time_obj = datetime.min.time().replace(hour=wake_hour, minute=wake_minute)
        except (ValueError, AttributeError):
            # Default to midnight and 8 AM if parsing fails
            sleep_time_obj = datetime.min.time().replace(hour=0, minute=0)
            wake_time_obj = datetime.min.time().replace(hour=8, minute=0)
        
        sleep_time_str = sleep_time_obj.strftime('%I:%M %p')
        wake_time_str = wake_time_obj.strftime('%I:%M %p')
        
        # Calculate meal timing windows based on wake/sleep times
        wake_dt = datetime.combine(target_date, wake_time_obj)
        sleep_dt = datetime.combine(target_date, sleep_time_obj)
        
        # Ideal breakfast: 1-2 hours after waking
        breakfast_start = wake_dt + timedelta(hours=1)
        breakfast_end = wake_dt + timedelta(hours=2)
        
        # Ideal lunch: Midday (around 12-1 PM, or 4-6 hours after breakfast)
        lunch_start = breakfast_end + timedelta(hours=4)
        lunch_end = breakfast_end + timedelta(hours=6)
        
        # Ideal dinner: 3-4 hours before bedtime
        dinner_end = sleep_dt - timedelta(hours=3)
        dinner_start = sleep_dt - timedelta(hours=5)
        
        # Build comprehensive prompt for Gemini
        meal_prompt = f"""You are a nutrition and meal timing expert helping someone plan optimal meal windows for their day.

{schedule_text}

😴 USER'S SLEEP SCHEDULE:
- Wake time: {wake_time_str}
- Bedtime: {sleep_time_str}

🍽️ MEAL TIMING SCIENCE PRINCIPLES:

1. **Breakfast**:
   - Should be eaten within 1-2 hours of waking to kickstart metabolism
   - Ideal window: {breakfast_start.strftime('%I:%M %p')} - {breakfast_end.strftime('%I:%M %p')}
   - Important for energy, focus, and preventing overeating later

2. **Lunch**:
   - Should be 4-6 hours after breakfast
   - Ideal window: {lunch_start.strftime('%I:%M %p')} - {lunch_end.strftime('%I:%M %p')}
   - Midday meal helps maintain steady energy and prevents afternoon crashes

3. **Dinner**:
   - Should be 3-4 hours before bedtime to allow for digestion
   - Ideal window: {dinner_start.strftime('%I:%M %p')} - {dinner_end.strftime('%I:%M %p')}
   - Eating too close to bedtime can disrupt sleep quality

4. **Snacks** (if needed):
   - Between breakfast and lunch (mid-morning)
   - Between lunch and dinner (afternoon)
   - Should be 2-3 hours after main meals
   - Only recommend if there are long gaps between meals

5. **Timing Guidelines**:
   - Space meals 4-6 hours apart for optimal digestion
   - Avoid eating within 3 hours of bedtime
   - Consider meal prep time and eating duration (typically 30-60 minutes)
   - Account for buffer time before/after important events or meetings
   - Factor in commute or preparation time if needed

6. **Context Considerations**:
   - Consider the intensity of events before/after potential meal times
   - Leave buffer time if user has important meetings or activities
   - Consider energy levels throughout the day
   - Avoid scheduling meals during or immediately before/after intense activities

**CRITICAL CONSTRAINTS**:

1. **NO OVERLAPS WITH EVENTS**:
   - You MUST NOT schedule any meal that overlaps with an existing calendar event
   - Only suggest meal times that fall completely outside of scheduled events
   - Check the schedule above carefully and ensure meal start/end times don't conflict with any events

2. **MEAL TIMING PRIORITY** (strongly prefer better times):
   - **ALWAYS recommend all three meals** (breakfast, lunch, dinner), but prioritize better timing
   - **Breakfast**: STRONGLY prefer times between wake time and 10:00 AM. If that's not possible, find the earliest available slot before 12:00 PM
   - **Lunch**: STRONGLY prefer times between 11:30 AM and 2:00 PM. If that's not possible, find the closest available slot (even if earlier or later)
   - **Dinner**: STRONGLY prefer times between 5:30 PM and 8:00 PM (and at least 3 hours before bedtime). If that's not possible, find an available evening slot
   - When the ideal window is blocked, choose the free slot that is CLOSEST in time to the ideal window
   - Give higher priority_score (8-10) to meals in ideal windows, lower scores (4-7) to meals at suboptimal times

3. **NO DUPLICATE MEALS**:
   - CAREFULLY check the schedule above for any existing meal-related events
   - Look for keywords like: breakfast, lunch, dinner, meal, snack, brunch, food, eat, dining, cafe, restaurant
   - Examples of existing meals: "Breakfast with team", "Lunch meeting", "Team dinner", "Coffee and snacks", "Morning meal"
   - If you see ANY event that indicates a meal is already scheduled, DO NOT recommend that meal type again
   - For example:
     * If you see "Breakfast with team" → DO NOT recommend breakfast
     * If you see "Lunch meeting" → DO NOT recommend lunch
     * If you see "Dinner at restaurant" → DO NOT recommend dinner
   - Only recommend meals that are NOT already on the calendar
   - If all three main meals (breakfast, lunch, dinner) are already scheduled, return an empty recommendations array with a summary like "All meals are already scheduled for this day"

**TASK**: Based on the user's schedule above, wake time ({wake_time_str}), and bedtime ({sleep_time_str}), provide personalized meal window recommendations for {target_date.strftime('%A, %B %d, %Y')}.

**IMPORTANT**: You MUST return ONLY valid JSON in this exact format (no markdown, no code blocks, just pure JSON):

{{
  "recommendations": [
    {{
      "type": "breakfast" or "lunch" or "dinner" or "snack",
      "title": "Breakfast" or "Lunch" or "Dinner" or "Snack",
      "start_time": "HH:MM" (24-hour format, e.g., "08:00"),
      "duration_minutes": 30-60,
      "reasoning": "Brief explanation of why this time works best",
      "priority_score": 1-10 (higher is better, based on optimal timing and schedule fit)
    }}
  ],
  "summary": "Brief overall explanation of recommendations"
}}

Return meal recommendations for breakfast, lunch, and dinner (and snacks only if needed to fill gaps). Prioritize times that work with the user's schedule. All times should be in 24-hour format (HH:MM)."""
        
        # Get API key and set up Gemini client
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        
        if not api_key:
            return json.dumps({"error": "GOOGLE_API_KEY or GEMINI_API_KEY not found. Cannot calculate meal windows."})
        
        # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key
        
        # Create Gemini client
        client = genai.Client()
        
        # List of models to try (prioritize models with available quota)
        # Note: gemma models need -it suffix for instruction-tuned versions
        models_to_try = [
            'gemini-3-flash-preview',  # Has quota available
            'gemini-2.0-flash-lite',  # Alternative flash model
            'gemma-3-12b-it',  # 0/30 RPM (has quota!)
            'gemma-3-27b-it',  # 0/30 RPM (has quota!)
            'gemma-3-4b-it',  # 0/30 RPM (has quota!)
            'gemma-3-1b-it',  # 0/30 RPM (has quota!)
            'gemini-2.5-flash',  # May be at quota limit
            'gemini-2.5-flash-lite',  # May be over quota limit
        ]
        
        last_error = None
        gemini_response = None
        
        for model in models_to_try:
            try:
                print(f"[MEAL] Trying model {model}...", flush=True)
                response = client.models.generate_content(
                    model=model,
                    contents=meal_prompt,
                )
                gemini_response = response.text
                print(f"[MEAL] Model {model} succeeded!", flush=True)
                break

            except Exception as e:
                error_str = str(e)
                print(f"[MEAL] Model {model} error: {type(e).__name__}: {error_str[:300]}", flush=True)
                # If it's a quota error, wait a bit and retry once
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    print(f"Model {model} quota exceeded, waiting 2 seconds and retrying...", flush=True)
                    time.sleep(2)
                    try:
                        response = client.models.generate_content(
                            model=model,
                            contents=meal_prompt,
                        )
                        gemini_response = response.text
                        break
                    except Exception as e2:
                        last_error = e2
                        print(f"Model {model} still failed after retry: {str(e2)[:200]}, trying next model...", flush=True)
                        continue
                # If it's a model not found error, try next model
                elif '404' in error_str or 'NOT_FOUND' in error_str:
                    last_error = e
                    print(f"Model {model} not found: {error_str[:200]}, trying next model...", flush=True)
                    continue
                # If it's not a recoverable error, raise it immediately
                else:
                    raise

        # If all SDK models failed, try REST API as fallback
        if not gemini_response:
            print("All SDK models failed, trying REST API fallback...", flush=True)
            gemini_response = _try_rest_api_fallback(api_key, meal_prompt, last_error)
        
        if not gemini_response:
            raise Exception(f"All models exhausted (SDK and REST API). Last error: {last_error}")
        
        # Parse Gemini's JSON response
        try:
            # Clean up the response - remove markdown code blocks if present
            cleaned_response = gemini_response.strip()
            if cleaned_response.startswith('```json'):
                cleaned_response = cleaned_response[7:]
            elif cleaned_response.startswith('```'):
                cleaned_response = cleaned_response[3:]
            if cleaned_response.endswith('```'):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()
            
            recommendations_data = json.loads(cleaned_response)
            
            # Convert recommendations to calendar event format
            calendar_events = []
            recommendations = recommendations_data.get('recommendations', [])
            
            # Sort by priority_score if available, otherwise keep order
            if recommendations and 'priority_score' in recommendations[0]:
                recommendations.sort(key=lambda x: x.get('priority_score', 0), reverse=True)
            
            for rec in recommendations:
                start_time_str = rec.get('start_time', '')
                duration = rec.get('duration_minutes', 45)
                meal_type = rec.get('type', 'meal')
                title = rec.get('title', meal_type.capitalize())
                reasoning = rec.get('reasoning', '')
                
                # Parse time and create datetime objects
                try:
                    hour, minute = map(int, start_time_str.split(':'))
                    start_dt = datetime.combine(target_date, datetime.min.time().replace(hour=hour, minute=minute))
                    end_dt = start_dt + timedelta(minutes=duration)
                    
                    # Format as ISO 8601 with timezone (Pacific Time)
                    start_iso = start_dt.strftime('%Y-%m-%dT%H:%M:%S-08:00')
                    end_iso = end_dt.strftime('%Y-%m-%dT%H:%M:%S-08:00')
                    
                    # Create calendar event in Google Calendar format
                    # These are suggested events for frontend display - user will choose which to keep
                    calendar_event = {
                        "kind": "calendar#event",
                        "summary": title,
                        "description": f"Recommended {title.lower()}. {reasoning}",
                        "start": {
                            "dateTime": start_iso,
                            "timeZone": "America/Los_Angeles"
                        },
                        "end": {
                            "dateTime": end_iso,
                            "timeZone": "America/Los_Angeles"
                        },
                        "colorId": "5",  # Yellow color for meals
                        "transparency": "transparent",  # Show as free/busy
                        "suggested": True,  # Flag to indicate this is a suggested event
                        "meal_type": meal_type,  # "breakfast", "lunch", "dinner", or "snack"
                        "duration_minutes": duration
                    }
                    
                    calendar_events.append(calendar_event)
                    
                except (ValueError, AttributeError) as e:
                    # Skip invalid time formats
                    continue
            
            # Return JSON array of calendar events
            return json.dumps({
                "events": calendar_events,
                "summary": recommendations_data.get('summary', ''),
                "count": len(calendar_events)
            }, indent=2)
            
        except json.JSONDecodeError as e:
            # If JSON parsing fails, return error with raw response for debugging
            return json.dumps({
                "error": "Failed to parse Gemini response as JSON",
                "raw_response": gemini_response[:500],  # First 500 chars for debugging
                "parse_error": str(e)
            })
        
    except Exception as e:
        return json.dumps({"error": f"Error calculating meal windows: {str(e)}"})


def predict_burnout_tool(date_str: str, user_id: str = 'default_user', 
                         sleep_time: str = '00:00', wake_time: str = '08:00',
                         provided_events: list = None) -> str:
    """Predict burnout score for a given date using Gemini AI
    
    Analyzes the calendar schedule for the specified date and uses Gemini AI to predict
    burnout risk based on schedule density, event types, sleep patterns, and ATUS research.

    Args:
        date_str: Date to analyze in ISO format 'YYYY-MM-DD' (e.g., '2026-01-11')
        user_id: User ID to load calendar data for (default: 'default_user')
        sleep_time: Bedtime in 24-hour format 'HH:MM' (default: '00:00' for midnight)
        wake_time: Wake time in 24-hour format 'HH:MM' (default: '08:00' for 8 AM)
    """
    try:
        target_date = datetime.fromisoformat(date_str).date()
        today = datetime.now().date()
        
        # Calculate days ahead needed to reach target date
        days_diff = (target_date - today).days
        if days_diff < 0:
            return json.dumps({"error": f"The date {date_str} is in the past. Please provide today's date or a future date."})
        if days_diff > 7:
            return json.dumps({"error": f"Date is more than 7 days away. Please provide a date within the next week."})
        
        # Require events from MongoDB via Node.js API
        if not provided_events:
            return json.dumps({"error": "Events must be provided from MongoDB via Node.js API. No fallback to JSON files."})
        
        # Events provided from MongoDB via Node.js API
        all_events = provided_events
        day_events = []
        week_events = []
        
        # Process events (works for both MongoDB and JSON formats)
        for event in all_events:
            # Handle both MongoDB format (startISO) and Google Calendar format (start.dateTime)
            startISO = event.get('startISO')
            if not startISO:
                start_data = event.get('start', {})
                if isinstance(start_data, dict):
                    startISO = start_data.get('dateTime') or start_data.get('date')
                else:
                    startISO = str(start_data) if start_data else None
            
            if startISO:
                try:
                    dt_str = startISO
                    if dt_str.endswith('Z'):
                        dt_str = dt_str[:-1] + '+00:00'
                    event_dt = datetime.fromisoformat(dt_str)
                    if event_dt.tzinfo:
                        event_dt = event_dt.astimezone().replace(tzinfo=None)
                    
                    event_date = event_dt.date()
                    
                    # Calculate end time for all events
                    endISO = event.get('endISO')
                    if not endISO:
                        end_data = event.get('end', {})
                        if isinstance(end_data, dict):
                            endISO = end_data.get('dateTime') or end_data.get('date')
                        else:
                            endISO = str(end_data) if end_data else None
                    
                    if endISO:
                        if isinstance(endISO, str):
                            if endISO.endswith('Z'):
                                endISO = endISO[:-1] + '+00:00'
                            event_end = datetime.fromisoformat(endISO)
                            if event_end.tzinfo:
                                event_end = event_end.astimezone().replace(tzinfo=None)
                        else:
                            event_end = event_dt + timedelta(hours=1)
                    else:
                        event_end = event_dt + timedelta(hours=1)
                    
                    # Check if event is on target date
                    if event_date == target_date:
                        day_events.append({
                            'title': event.get('title') or event.get('summary', 'Event'),
                            'start': event_dt,
                            'end': event_end,
                            'description': event.get('description', '')
                        })
                    
                    # Also collect events from 3 days before to 3 days after for context
                    days_from_target = (event_date - target_date).days
                    if -3 <= days_from_target <= 3:
                        week_events.append({
                            'title': event.get('title') or event.get('summary', 'Event'),
                            'date': event_date,
                            'start': event_dt,
                            'end': event_end
                        })
                except (ValueError, AttributeError):
                    continue
        
        # Sort events by start time
        day_events.sort(key=lambda x: x['start'])
        week_events.sort(key=lambda x: (x['date'], x['start']))

        # Calculate schedule metrics for context
        total_hours = 0
        num_events = len(day_events)
        back_to_back_count = 0
        short_gaps = 0
        earliest_start = None
        latest_end = None

        if day_events:
            earliest_start = day_events[0]['start']
            latest_end = day_events[-1]['end']

            for i, event in enumerate(day_events):
                duration = (event['end'] - event['start']).total_seconds() / 3600
                total_hours += duration

                if i < len(day_events) - 1:
                    gap = (day_events[i + 1]['start'] - event['end']).total_seconds() / 60
                    if gap <= 15:
                        back_to_back_count += 1
                    elif gap < 30:
                        short_gaps += 1

        # Format schedule for Gemini prompt
        schedule_text = ""
        if day_events:
            schedule_text = f"\n\n📅 SCHEDULE FOR {target_date.strftime('%A, %B %d, %Y')}:\n\n"
            for event in day_events:
                start_time = event['start'].strftime('%I:%M %p')
                end_time = event['end'].strftime('%I:%M %p')
                duration = (event['end'] - event['start']).total_seconds() / 3600
                schedule_text += f"• {start_time} - {end_time}: {event['title']} ({duration:.1f}h)\n"

            schedule_text += f"\n📊 SCHEDULE METRICS:\n"
            schedule_text += f"- Total events: {num_events}\n"
            schedule_text += f"- Total scheduled time: {total_hours:.1f} hours\n"
            schedule_text += f"- Back-to-back events (≤15 min gap): {back_to_back_count}\n"
            schedule_text += f"- Short breaks (<30 min gap): {short_gaps}\n"
            if earliest_start:
                schedule_text += f"- First event starts: {earliest_start.strftime('%I:%M %p')}\n"
            if latest_end:
                schedule_text += f"- Last event ends: {latest_end.strftime('%I:%M %p')}\n"
            if earliest_start and latest_end:
                day_span = (latest_end - earliest_start).total_seconds() / 3600
                schedule_text += f"- Day span: {day_span:.1f} hours\n"
        else:
            schedule_text = f"\n\n📅 SCHEDULE FOR {target_date.strftime('%A, %B %d, %Y')}:\nNo events scheduled for this day.\n"
        
        # Format week context
        week_context = ""
        if week_events:
            week_context = "\n\n📊 WEEK CONTEXT (3 days before and after):\n\n"
            events_by_date = {}
            for event in week_events:
                date_key = event['date'].isoformat()
                if date_key not in events_by_date:
                    events_by_date[date_key] = []
                events_by_date[date_key].append(event)
            
            for date_key in sorted(events_by_date.keys()):
                date_obj = datetime.fromisoformat(date_key).date()
                events = events_by_date[date_key]
                week_context += f"{date_obj.strftime('%A, %B %d')}: {len(events)} events\n"
        
        # Parse sleep and wake times
        try:
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            sleep_time_obj = datetime.min.time().replace(hour=sleep_hour, minute=sleep_minute)
            wake_time_obj = datetime.min.time().replace(hour=wake_hour, minute=wake_minute)
        except (ValueError, AttributeError):
            sleep_time_obj = datetime.min.time().replace(hour=0, minute=0)
            wake_time_obj = datetime.min.time().replace(hour=8, minute=0)
        
        sleep_time_str = sleep_time_obj.strftime('%I:%M %p')
        wake_time_str = wake_time_obj.strftime('%I:%M %p')
        
        # Calculate sleep duration
        sleep_dt = datetime.combine(target_date, sleep_time_obj)
        wake_dt = datetime.combine(target_date, wake_time_obj)
        if wake_dt < sleep_dt:
            wake_dt += timedelta(days=1)
        sleep_duration = (wake_dt - sleep_dt).total_seconds() / 3600
        
        # Build comprehensive prompt for Gemini
        burnout_prompt = f"""You are a burnout and stress analysis expert using evidence-based research.

{schedule_text}

{week_context}

😴 USER'S SLEEP SCHEDULE:
- Bedtime: {sleep_time_str}
- Wake time: {wake_time_str}
- Sleep duration: {sleep_duration:.1f} hours

🧠 ANALYZE THE SCHEDULE AND DETERMINE BURNOUT RISK:

Consider these factors when scoring:

1. **Schedule Density** - How packed is the day?
   - Back-to-back events with no breaks are exhausting
   - Long spans (8+ hours) from first to last event increase fatigue
   - Many events = more cognitive load and transitions

2. **Event Types** - What kind of activities?
   - High-stakes (exams, presentations, interviews, deadlines) = HIGH stress
   - Regular classes/meetings = MODERATE stress
   - Meals, breaks, naps = RESTORATIVE (reduce stress)
   - Social activities, exercise, hobbies = can be RESTORATIVE or neutral

3. **Sleep Quality**
   - <6 hours = significantly increased burnout risk
   - 6-7 hours = somewhat elevated risk
   - 7-8 hours = optimal
   - >8 hours = well-rested

4. **Time Pressure**
   - Early starts (before 8 AM) after late nights = exhausting
   - No time for meals = red flag
   - Consecutive demanding days = cumulative stress

📊 SCORING SCALE (0-100):
- 0-25: Very low risk - light day, plenty of breaks, restorative activities
- 26-40: Low risk - manageable schedule, some commitments but balanced
- 41-55: Moderate risk - busy day, limited breaks, building stress
- 56-70: High risk - packed schedule, back-to-back events, limited recovery
- 71-85: Very high risk - overwhelming schedule, multiple high-stakes events
- 86-100: Critical - unsustainable, immediate intervention needed

**IMPORTANT**:
- A day with 5+ back-to-back classes/meetings is NOT "low risk" even if they're just classes
- Meals and naps scheduled in gaps are GOOD - they reduce the score
- Look at the ACTUAL event names to determine if they're stressful or restorative

Return ONLY valid JSON (no markdown, no code blocks):

{{
  "score": 0-100 (integer),
  "status": "stable" or "building" or "high-risk" or "critical",
  "reasoning": "Explain your score based on the specific events and schedule density",
  "key_factors": ["factor1", "factor2", "factor3"],
  "recommendations": ["recommendation1", "recommendation2"]
}}"""
        
        # Get API key and set up Gemini client
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        
        if not api_key:
            return json.dumps({"error": "GOOGLE_API_KEY or GEMINI_API_KEY not found"})
        
        # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key
        
        # Create Gemini client
        client = genai.Client()
        
        # List of models to try (prioritize models with available quota)
        # Note: gemma models need -it suffix for instruction-tuned versions
        models_to_try = [
            'gemini-3-flash-preview',  # Has quota available
            'gemini-2.0-flash-lite',  # Alternative flash model
            'gemma-3-12b-it',  # 0/30 RPM (has quota!)
            'gemma-3-27b-it',  # 0/30 RPM (has quota!)
            'gemma-3-4b-it',  # 0/30 RPM (has quota!)
            'gemma-3-1b-it',  # 0/30 RPM (has quota!)
            'gemini-2.5-flash',  # May be at quota limit
            'gemini-2.5-flash-lite',  # May be over quota limit
        ]
        
        last_error = None
        gemini_response = None
        
        for model in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=burnout_prompt,
                )
                gemini_response = response.text
                break
                
            except Exception as e:
                error_str = str(e)
                # If it's a quota error, wait a bit and retry once
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    print(f"Model {model} quota exceeded, waiting 2 seconds and retrying...", flush=True)
                    time.sleep(2)
                    try:
                        response = client.models.generate_content(
                            model=model,
                            contents=burnout_prompt,
                        )
                        gemini_response = response.text
                        break
                    except Exception as e2:
                        last_error = e2
                        print(f"Model {model} still failed after retry: {str(e2)[:200]}, trying next model...", flush=True)
                        continue
                # If it's a model not found error, try next model
                elif '404' in error_str or 'NOT_FOUND' in error_str:
                    last_error = e
                    print(f"Model {model} not found: {error_str[:200]}, trying next model...", flush=True)
                    continue
                # If it's not a recoverable error, raise it immediately
                else:
                    raise
        
        # If all SDK models failed, try REST API as fallback
        if not gemini_response:
            print("All SDK models failed, trying REST API fallback...", flush=True)
            gemini_response = _try_rest_api_fallback(api_key, burnout_prompt, last_error)
        
        if not gemini_response:
            raise Exception(f"All models exhausted (SDK and REST API). Last error: {last_error}")
        
        # Parse Gemini's JSON response
        try:
            # Clean up the response - remove markdown code blocks if present
            cleaned_response = gemini_response.strip()
            if cleaned_response.startswith('```json'):
                cleaned_response = cleaned_response[7:]
            elif cleaned_response.startswith('```'):
                cleaned_response = cleaned_response[3:]
            if cleaned_response.endswith('```'):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()
            
            prediction_data = json.loads(cleaned_response)

            # Validate and ensure score is in range
            score = prediction_data.get('score', 50)
            if not isinstance(score, int):
                try:
                    score = int(float(score))
                except (ValueError, TypeError):
                    score = 50
            score = max(0, min(100, score))

            # Ensure status matches the score
            if score <= 30:
                status = 'stable'
            elif score <= 50:
                status = 'building'
            elif score <= 70:
                status = 'high-risk'
            else:
                status = 'critical'
            
            return json.dumps({
                "score": score,
                "status": status,
                "reasoning": prediction_data.get('reasoning', ''),
                "key_factors": prediction_data.get('key_factors', []),
                "recommendations": prediction_data.get('recommendations', [])
            }, indent=2)
            
        except json.JSONDecodeError as e:
            # If JSON parsing fails, return error with raw response for debugging
            return json.dumps({
                "error": "Failed to parse Gemini response as JSON",
                "raw_response": gemini_response[:500],
                "parse_error": str(e)
            })
        
    except Exception as e:
        return json.dumps({"error": f"Error predicting burnout: {str(e)}"})


def predict_burnout_batch_tool(user_id: str = 'default_user', 
                               sleep_time: str = '00:00', wake_time: str = '08:00',
                               days_ahead: int = 14, provided_events: list = None) -> str:
    """Predict burnout scores for the next N days using Gemini AI (batch processing)
    
    Analyzes calendar schedules for multiple days and uses Gemini AI to predict
    burnout risk for all days in a single prompt. Results are cached.

    Args:
        user_id: User ID to load calendar data for (default: 'default_user')
        sleep_time: Bedtime in 24-hour format 'HH:MM' (default: '00:00' for midnight)
        wake_time: Wake time in 24-hour format 'HH:MM' (default: '08:00' for 8 AM)
        days_ahead: Number of days to predict (default: 14)
    """
    try:
        today = datetime.now().date()
        script_dir = os.path.dirname(os.path.abspath(__file__))
        user_calendars_path = os.path.join(script_dir, 'user_data', f'{user_id}_calendars.json')
        
        # Get events for the next N days
        date_range = []
        events_by_date = {}
        
        for i in range(days_ahead):
            target_date = today + timedelta(days=i)
            date_range.append(target_date)
            events_by_date[target_date] = []
        
        # Require events from MongoDB via Node.js API
        if not provided_events:
            return json.dumps({"error": "Events must be provided from MongoDB via Node.js API. No fallback to JSON files."})
        
        # Events provided from MongoDB via Node.js API
        all_events = provided_events
        
        # Process events (works for both MongoDB and JSON formats)
        for event in all_events:
            # Handle both MongoDB format (startISO) and Google Calendar format (start.dateTime)
            startISO = event.get('startISO')
            if not startISO:
                start_data = event.get('start', {})
                if isinstance(start_data, dict):
                    startISO = start_data.get('dateTime') or start_data.get('date')
                else:
                    startISO = str(start_data) if start_data else None
            
            if startISO:
                try:
                    dt_str = startISO
                    if dt_str.endswith('Z'):
                        dt_str = dt_str[:-1] + '+00:00'
                    event_dt = datetime.fromisoformat(dt_str)
                    if event_dt.tzinfo:
                        event_dt = event_dt.astimezone().replace(tzinfo=None)
                    
                    event_date = event_dt.date()
                    
                    if event_date in events_by_date:
                        # Parse end time
                        endISO = event.get('endISO')
                        if not endISO:
                            end_data = event.get('end', {})
                            if isinstance(end_data, dict):
                                endISO = end_data.get('dateTime') or end_data.get('date')
                            else:
                                endISO = str(end_data) if end_data else None
                        
                        if endISO:
                            if isinstance(endISO, str):
                                if endISO.endswith('Z'):
                                    endISO = endISO[:-1] + '+00:00'
                                event_end = datetime.fromisoformat(endISO)
                                if event_end.tzinfo:
                                    event_end = event_end.astimezone().replace(tzinfo=None)
                            else:
                                event_end = event_dt + timedelta(hours=1)
                        else:
                            event_end = event_dt + timedelta(hours=1)
                        
                        events_by_date[event_date].append({
                            'title': event.get('title') or event.get('summary', 'Event'),
                            'start': event_dt,
                            'end': event_end,
                            'description': event.get('description', '')
                        })
                except (ValueError, AttributeError):
                    continue
        
        # Load previous burnout scores from cache for historical context
        previous_cache = load_burnout_cache(user_id=user_id)
        historical_context = ""
        recent_scores = []
        
        # Get burnout scores for the last 7 days before today (if available)
        for i in range(1, 8):  # 1 to 7 days ago
            past_date = today - timedelta(days=i)
            past_date_str = past_date.isoformat()
            if past_date_str in previous_cache:
                pred = previous_cache[past_date_str]
                recent_scores.append({
                    'date': past_date_str,
                    'score': pred.get('score', 50),
                    'status': pred.get('status', 'building')
                })
        
        if recent_scores:
            # Sort by date (oldest first)
            recent_scores.sort(key=lambda x: x['date'])
            historical_context = "\n\n📊 RECENT BURNOUT HISTORY (Last 7 Days):\n"
            for score_data in recent_scores:
                date_obj = datetime.fromisoformat(score_data['date']).date()
                historical_context += f"  • {date_obj.strftime('%A, %B %d')}: Score {score_data['score']}/100 ({score_data['status']})\n"
            
            # Calculate average recent burnout
            avg_recent = sum(s['score'] for s in recent_scores) / len(recent_scores)
            historical_context += f"\n  Average recent burnout: {avg_recent:.1f}/100\n"
        
        # Format schedules for all days
        schedules_text = ""
        for target_date in date_range:
            day_events = events_by_date[target_date]
            day_events.sort(key=lambda x: x['start'])

            # Calculate metrics for context
            total_hours = 0
            num_events = len(day_events)
            back_to_back_count = 0
            short_gaps = 0
            earliest_start = None
            latest_end = None

            if day_events:
                earliest_start = day_events[0]['start']
                latest_end = day_events[-1]['end']

                for i, event in enumerate(day_events):
                    duration = (event['end'] - event['start']).total_seconds() / 3600
                    total_hours += duration

                    if i < len(day_events) - 1:
                        gap = (day_events[i + 1]['start'] - event['end']).total_seconds() / 60
                        if gap <= 15:
                            back_to_back_count += 1
                        elif gap < 30:
                            short_gaps += 1

            # Format schedule text
            if day_events:
                schedules_text += f"\n\n📅 {target_date.strftime('%A, %B %d, %Y')}:\n"
                for event in day_events:
                    start_time = event['start'].strftime('%I:%M %p')
                    end_time = event['end'].strftime('%I:%M %p')
                    duration = (event['end'] - event['start']).total_seconds() / 3600
                    schedules_text += f"  • {start_time} - {end_time}: {event['title']} ({duration:.1f}h)\n"
                schedules_text += f"  📊 Metrics: {num_events} events, {total_hours:.1f}h total, {back_to_back_count} back-to-back\n"
                if earliest_start and latest_end:
                    day_span = (latest_end - earliest_start).total_seconds() / 3600
                    schedules_text += f"  📊 Day span: {earliest_start.strftime('%I:%M %p')} - {latest_end.strftime('%I:%M %p')} ({day_span:.1f}h)\n"
            else:
                schedules_text += f"\n\n📅 {target_date.strftime('%A, %B %d, %Y')}:\n  No events scheduled\n"
        
        # Parse sleep and wake times
        try:
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            sleep_time_obj = datetime.min.time().replace(hour=sleep_hour, minute=sleep_minute)
            wake_time_obj = datetime.min.time().replace(hour=wake_hour, minute=wake_minute)
        except (ValueError, AttributeError):
            sleep_time_obj = datetime.min.time().replace(hour=0, minute=0)
            wake_time_obj = datetime.min.time().replace(hour=8, minute=0)
        
        sleep_time_str = sleep_time_obj.strftime('%I:%M %p')
        wake_time_str = wake_time_obj.strftime('%I:%M %p')
        
        # Calculate sleep duration
        sleep_dt = datetime.combine(today, sleep_time_obj)
        wake_dt = datetime.combine(today, wake_time_obj)
        if wake_dt < sleep_dt:
            wake_dt += timedelta(days=1)
        sleep_duration = (wake_dt - sleep_dt).total_seconds() / 3600
        
        # Build comprehensive prompt for Gemini
        burnout_prompt = f"""You are a burnout and stress analysis expert using evidence-based research.

{historical_context}

{schedules_text}

😴 USER'S SLEEP SCHEDULE:
- Bedtime: {sleep_time_str}
- Wake time: {wake_time_str}
- Sleep duration: {sleep_duration:.1f} hours

🧠 ANALYZE EACH DAY'S SCHEDULE AND DETERMINE BURNOUT RISK:

Consider these factors when scoring each day:

1. **Schedule Density** - How packed is the day?
   - Back-to-back events with no breaks are exhausting
   - Long spans (8+ hours) from first to last event increase fatigue
   - Many events = more cognitive load and transitions

2. **Event Types** - What kind of activities?
   - High-stakes (exams, presentations, interviews, deadlines) = HIGH stress
   - Regular classes/meetings = MODERATE stress
   - Meals, breaks, naps = RESTORATIVE (reduce stress)
   - Social activities, exercise, hobbies = can be RESTORATIVE or neutral

3. **Sleep Quality**
   - <6 hours = significantly increased burnout risk
   - 6-7 hours = somewhat elevated risk
   - 7-8 hours = optimal
   - >8 hours = well-rested

4. **Cumulative Effects**
   - Consecutive high-stress days compound fatigue
   - Rest days help recovery
   - Consider the week's pattern, not just each day in isolation

📊 SCORING SCALE (0-100):
- 0-25: Very low risk - light day, plenty of breaks, restorative activities
- 26-40: Low risk - manageable schedule, some commitments but balanced
- 41-55: Moderate risk - busy day, limited breaks, building stress
- 56-70: High risk - packed schedule, back-to-back events, limited recovery
- 71-85: Very high risk - overwhelming schedule, multiple high-stakes events
- 86-100: Critical - unsustainable, immediate intervention needed

**IMPORTANT**:
- A day with 5+ back-to-back classes/meetings is NOT "low risk"
- Meals and naps scheduled in gaps are GOOD - they reduce the score
- Look at the ACTUAL event names to determine if they're stressful or restorative
- Empty days or days with only 1-2 events should score LOW (under 30)

Return ONLY valid JSON (no markdown, no code blocks):

{{
  "predictions": [
    {{
      "date": "YYYY-MM-DD",
      "score": 0-100 (integer),
      "status": "stable" or "building" or "high-risk" or "critical",
      "reasoning": "Brief explanation based on specific events"
    }}
  ]
}}

Return predictions for ALL {days_ahead} days in chronological order."""
        
        # Get API key and set up Gemini client
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        
        if not api_key:
            return json.dumps({"error": "GOOGLE_API_KEY or GEMINI_API_KEY not found. Cannot predict burnout."})
        
        # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key
        
        # Create Gemini client
        client = genai.Client()
        
        # List of models to try (prioritize models with available quota)
        # Note: gemma models need -it suffix for instruction-tuned versions
        models_to_try = [
            'gemini-3-flash-preview',  # Has quota available
            'gemini-2.0-flash-lite',  # Alternative flash model
            'gemma-3-12b-it',  # 0/30 RPM (has quota!)
            'gemma-3-27b-it',  # 0/30 RPM (has quota!)
            'gemma-3-4b-it',  # 0/30 RPM (has quota!)
            'gemma-3-1b-it',  # 0/30 RPM (has quota!)
            'gemini-2.5-flash',  # May be at quota limit
            'gemini-2.5-flash-lite',  # May be over quota limit
        ]
        
        last_error = None
        gemini_response = None
        
        for model in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=burnout_prompt,
                )
                gemini_response = response.text
                break
                
            except Exception as e:
                error_str = str(e)
                # If it's a quota error, wait a bit and retry once
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    print(f"Model {model} quota exceeded, waiting 2 seconds and retrying...", flush=True)
                    time.sleep(2)
                    try:
                        response = client.models.generate_content(
                            model=model,
                            contents=burnout_prompt,
                        )
                        gemini_response = response.text
                        break
                    except Exception as e2:
                        last_error = e2
                        print(f"Model {model} still failed after retry: {str(e2)[:200]}, trying next model...", flush=True)
                        continue
                # If it's a model not found error, try next model
                elif '404' in error_str or 'NOT_FOUND' in error_str:
                    last_error = e
                    print(f"Model {model} not found: {error_str[:200]}, trying next model...", flush=True)
                    continue
                # If it's not a recoverable error, raise it immediately
                else:
                    raise
        
        # If all SDK models failed, try REST API as fallback
        if not gemini_response:
            print("All SDK models failed, trying REST API fallback...", flush=True)
            gemini_response = _try_rest_api_fallback(api_key, burnout_prompt, last_error)
        
        if not gemini_response:
            raise Exception(f"All models exhausted (SDK and REST API). Last error: {last_error}")
        
        # Parse Gemini's JSON response
        try:
            # Clean up the response - remove markdown code blocks if present
            cleaned_response = gemini_response.strip()
            if cleaned_response.startswith('```json'):
                cleaned_response = cleaned_response[7:]
            elif cleaned_response.startswith('```'):
                cleaned_response = cleaned_response[3:]
            if cleaned_response.endswith('```'):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()
            
            prediction_data = json.loads(cleaned_response)
            predictions = prediction_data.get('predictions', [])

            # Validate and process predictions
            validated_predictions = {}
            for pred in predictions:
                date_str = pred.get('date')
                if not date_str:
                    continue

                score = pred.get('score', 50)
                if not isinstance(score, int):
                    try:
                        score = int(float(score))
                    except (ValueError, TypeError):
                        score = 50
                score = max(0, min(100, score))

                # Ensure status matches the score
                if score <= 30:
                    status = 'stable'
                elif score <= 50:
                    status = 'building'
                elif score <= 70:
                    status = 'high-risk'
                else:
                    status = 'critical'

                validated_predictions[date_str] = {
                    'score': score,
                    'status': status,
                    'reasoning': pred.get('reasoning', '')
                }
            
            # Save to cache
            cache_path = os.path.join(script_dir, 'user_data', f'{user_id}_burnout_cache.json')
            cache_data = {
                'user_id': user_id,
                'cached_at': datetime.now().isoformat(),
                'sleep_time': sleep_time,
                'wake_time': wake_time,
                'predictions': validated_predictions
            }
            
            with open(cache_path, 'w') as f:
                json.dump(cache_data, f, indent=2)
            
            return json.dumps({
                "success": True,
                "predictions": validated_predictions,
                "cached": True
            }, indent=2)
            
        except json.JSONDecodeError as e:
            # If JSON parsing fails, return error with raw response for debugging
            return json.dumps({
                "error": "Failed to parse Gemini response as JSON",
                "raw_response": gemini_response[:500],
                "parse_error": str(e)
            })
        
    except Exception as e:
        return json.dumps({"error": f"Error predicting burnout batch: {str(e)}"})


def load_burnout_cache(user_id: str = 'default_user') -> dict:
    """Load cached burnout predictions

    Returns:
        Dictionary with cached predictions, or empty dict if cache doesn't exist
    """
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        cache_path = os.path.join(script_dir, 'user_data', f'{user_id}_burnout_cache.json')

        if os.path.exists(cache_path):
            with open(cache_path, 'r') as f:
                cache_data = json.load(f)
                return cache_data.get('predictions', {})
        return {}
    except Exception as e:
        print(f"Warning: Could not load burnout cache: {e}", flush=True)
        return {}


def optimize_schedule_tool(user_id: str = 'default_user',
                           week_start: str = None,
                           sleep_time: str = '00:00',
                           wake_time: str = '08:00',
                           provided_events: list = None) -> str:
    """Optimize schedule by suggesting better times for malleable events.

    Uses Gemini AI to analyze the week's schedule and suggest optimal
    rescheduling for events marked as 'malleable', avoiding conflicts
    with 'fixed' events.

    Args:
        user_id: User ID (default: 'default_user')
        week_start: Start date of week in ISO format 'YYYY-MM-DD'
        sleep_time: Bedtime in 24-hour format 'HH:MM'
        wake_time: Wake time in 24-hour format 'HH:MM'
        provided_events: List of events from MongoDB

    Returns:
        JSON string with proposed schedule changes
    """
    try:
        # Determine week start date
        if week_start:
            start_date = datetime.fromisoformat(week_start).date()
        else:
            start_date = datetime.now().date()

        end_date = start_date + timedelta(days=7)

        if not provided_events:
            return json.dumps({"error": "Events must be provided from MongoDB"})

        # Separate fixed and malleable events
        fixed_events = []
        malleable_events = []

        for event in provided_events:
            # Parse start time
            startISO = event.get('startISO') or event.get('startTs')
            if not startISO:
                continue

            try:
                if isinstance(startISO, str):
                    if startISO.endswith('Z'):
                        startISO = startISO[:-1] + '+00:00'
                    event_start = datetime.fromisoformat(startISO)
                    if event_start.tzinfo:
                        event_start = event_start.astimezone().replace(tzinfo=None)
                else:
                    continue

                # Check if within our week range
                if not (start_date <= event_start.date() < end_date):
                    continue

                # Parse end time
                endISO = event.get('endISO') or event.get('endTs')
                if endISO and isinstance(endISO, str):
                    if endISO.endswith('Z'):
                        endISO = endISO[:-1] + '+00:00'
                    event_end = datetime.fromisoformat(endISO)
                    if event_end.tzinfo:
                        event_end = event_end.astimezone().replace(tzinfo=None)
                else:
                    event_end = event_start + timedelta(hours=1)

                event_data = {
                    'id': str(event.get('_id', '')),
                    'title': event.get('title', 'Event'),
                    'start': event_start,
                    'end': event_end,
                    'type': event.get('type', 'event'),
                    'status': event.get('status', 'fixed'),
                    'duration_minutes': int((event_end - event_start).total_seconds() / 60)
                }

                if event.get('status') == 'malleable':
                    malleable_events.append(event_data)
                else:
                    fixed_events.append(event_data)

            except (ValueError, AttributeError):
                continue

        if not malleable_events:
            return json.dumps({
                "success": True,
                "proposed_changes": [],
                "summary": "No malleable events found to optimize"
            })

        # Sort events by start time
        fixed_events.sort(key=lambda x: x['start'])
        malleable_events.sort(key=lambda x: x['start'])

        # Format fixed events for prompt
        fixed_text = "\n\nFIXED EVENTS (cannot be moved):\n"
        for ev in fixed_events:
            fixed_text += f"  {ev['start'].strftime('%a %m/%d %I:%M %p')} - {ev['end'].strftime('%I:%M %p')}: {ev['title']} ({ev['type']})\n"

        if not fixed_events:
            fixed_text += "  (No fixed events)\n"

        # Format malleable events for prompt
        malleable_text = "\n\nMALLEABLE EVENTS (can be rescheduled):\n"
        for ev in malleable_events:
            malleable_text += f"  ID: {ev['id']}\n"
            malleable_text += f"  Title: {ev['title']} ({ev['type']})\n"
            malleable_text += f"  Current: {ev['start'].strftime('%a %m/%d %I:%M %p')} - {ev['end'].strftime('%I:%M %p')}\n"
            malleable_text += f"  Duration: {ev['duration_minutes']} minutes\n\n"

        # Build optimization prompt - include ISO timestamps for accuracy
        # Format events with ISO strings for the AI
        fixed_iso_text = "\n\nFIXED EVENTS (cannot be moved):\n"
        for ev in fixed_events:
            fixed_iso_text += f"  {ev['start'].strftime('%a %m/%d %I:%M %p')} - {ev['end'].strftime('%I:%M %p')}: {ev['title']} ({ev['type']})\n"
            fixed_iso_text += f"    [ISO: {ev['start'].isoformat()} to {ev['end'].isoformat()}]\n"

        if not fixed_events:
            fixed_iso_text += "  (No fixed events)\n"

        malleable_iso_text = "\n\nMALLEABLE EVENTS (can be rescheduled):\n"
        for ev in malleable_events:
            malleable_iso_text += f"  ID: {ev['id']}\n"
            malleable_iso_text += f"  Title: {ev['title']} ({ev['type']})\n"
            malleable_iso_text += f"  Current: {ev['start'].strftime('%a %m/%d %I:%M %p')} - {ev['end'].strftime('%I:%M %p')}\n"
            malleable_iso_text += f"  ISO Start: {ev['start'].isoformat()}\n"
            malleable_iso_text += f"  ISO End: {ev['end'].isoformat()}\n"
            malleable_iso_text += f"  Duration: {ev['duration_minutes']} minutes\n\n"

        optimize_prompt = f"""You are a schedule optimization expert helping reduce burnout.

Week: {start_date.strftime('%B %d')} - {end_date.strftime('%B %d, %Y')}
Sleep: {sleep_time} | Wake: {wake_time}
{fixed_iso_text}
{malleable_iso_text}

CRITICAL OPTIMIZATION RULES (MUST FOLLOW ALL):
1. **SAME DAY ONLY** - The proposed_start date MUST match current_start date EXACTLY!
   - If current is 2026-01-13, proposed MUST be 2026-01-13 (NOT 2026-01-14 or 2026-01-15!)
   - NEVER change the YYYY-MM-DD portion, only change the HH:MM:SS
   - A meal on Wednesday stays on Wednesday, a nap on Monday stays on Monday
2. **ABSOLUTELY NO CONFLICTS** - Before proposing ANY time, verify it does NOT overlap with fixed events:
   - For each malleable event, look at the FIXED events on that SAME DAY
   - Your proposed time CANNOT start during a fixed event
   - Your proposed time CANNOT end during a fixed event
   - Example: If pstat 171 is 14:00-15:00, you CANNOT propose 14:00, 14:30, or any time that overlaps
3. Keep at least 15-minute buffers between events when possible
4. Avoid scheduling events during sleep hours ({sleep_time} to {wake_time})
5. Consider event types for optimal timing (but ONLY if the slot is FREE):
   - Breakfast: 7-9 AM
   - Lunch: 11 AM - 1 PM (but CHECK for conflicts first!)
   - Dinner: 5-8 PM
   - Naps: Early afternoon (1-4 PM) for best rest
   - Exercise: Morning (6-10 AM) or late afternoon (4-6 PM)
6. Preserve the original duration of each event
7. If no conflict-free optimal time exists, use action "keep" instead of "move"

IMPORTANT:
- Use 24-HOUR TIME FORMAT (e.g., 14:00 for 2 PM, 09:00 for 9 AM)
- Use the EXACT ISO format from the input for dates
- The proposed times must use the SAME date as the current_start (same YYYY-MM-DD)

For each malleable event, decide:
- KEEP: If current time is already good for that event type
- MOVE: Only if a significantly better time slot exists ON THE SAME DAY

Return ONLY valid JSON (no markdown):

{{
  "proposed_changes": [
    {{
      "event_id": "the event's ID (copy exactly from input)",
      "event_title": "event title",
      "action": "keep" or "move",
      "current_start": "copy the ISO Start from input",
      "current_end": "copy the ISO End from input",
      "proposed_start": "YYYY-MM-DDTHH:MM:SS (24-hour format! 2PM = 14:00, same date as current)",
      "proposed_end": "YYYY-MM-DDTHH:MM:SS (24-hour format! maintain original duration)",
      "reasoning": "Brief explanation of why this time is better (or why keeping is best)"
    }}
  ],
  "summary": "Brief overall optimization summary"
}}"""

        # Get API key
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        if not api_key:
            return json.dumps({"error": "API key not found"})

        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key

        client = genai.Client()

        # Try models
        models_to_try = [
            'gemini-3-flash-preview',
            'gemini-2.0-flash-lite',
            'gemma-3-12b-it',
            'gemini-2.5-flash',
        ]

        gemini_response = None
        last_error = None

        for model in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=optimize_prompt,
                )
                gemini_response = response.text
                break
            except Exception as e:
                last_error = e
                if '429' in str(e) or 'RESOURCE_EXHAUSTED' in str(e):
                    time.sleep(2)
                continue

        if not gemini_response:
            gemini_response = _try_rest_api_fallback(api_key, optimize_prompt, last_error)

        if not gemini_response:
            return json.dumps({"error": f"All models failed: {last_error}"})

        # Parse response
        cleaned = gemini_response.strip()
        if cleaned.startswith('```json'):
            cleaned = cleaned[7:]
        elif cleaned.startswith('```'):
            cleaned = cleaned[3:]
        if cleaned.endswith('```'):
            cleaned = cleaned[:-3]

        result = json.loads(cleaned.strip())

        # Filter to only include actual moves
        changes = result.get('proposed_changes', [])
        moves_only = [c for c in changes if c.get('action') == 'move']

        # Build a lookup map from event ID to ensure we have valid MongoDB IDs
        id_lookup = {ev['id']: ev for ev in malleable_events}
        title_lookup = {ev['title'].lower(): ev for ev in malleable_events}

        # Helper function to check if a proposed time conflicts with fixed events
        def has_conflict(proposed_start_str, proposed_end_str, fixed_events, event_title=""):
            try:
                # Parse the proposed times - Gemini returns naive local time strings
                # DON'T add timezone - treat as naive local time to match fixed_events
                clean_start = proposed_start_str.replace('Z', '').replace('+00:00', '')
                clean_end = proposed_end_str.replace('Z', '').replace('+00:00', '')

                # Handle potential timezone suffix
                if '+' in clean_start:
                    clean_start = clean_start.split('+')[0]
                if '+' in clean_end:
                    clean_end = clean_end.split('+')[0]
                if '-' in clean_start and clean_start.count('-') > 2:
                    # Has timezone like -08:00
                    clean_start = clean_start.rsplit('-', 1)[0]
                if '-' in clean_end and clean_end.count('-') > 2:
                    clean_end = clean_end.rsplit('-', 1)[0]

                prop_start = datetime.fromisoformat(clean_start)
                prop_end = datetime.fromisoformat(clean_end)

                print(f"DEBUG has_conflict: Checking '{event_title}'", flush=True)
                print(f"  Proposed: {prop_start} to {prop_end}", flush=True)
            except Exception as e:
                print(f"DEBUG has_conflict: Parse error for {proposed_start_str}: {e}", flush=True)
                return True  # Invalid date format, reject

            # Only check fixed events on the SAME DAY as the proposed time
            prop_date = prop_start.date()
            same_day_fixed = [f for f in fixed_events if f['start'].date() == prop_date]
            print(f"  Checking against {len(same_day_fixed)} fixed events on {prop_date}", flush=True)

            for fixed in same_day_fixed:
                fixed_start = fixed['start']
                fixed_end = fixed['end']
                print(f"  vs Fixed '{fixed['title']}': {fixed_start} to {fixed_end}", flush=True)
                # Check for overlap: two ranges overlap if start1 < end2 AND end1 > start2
                if prop_start < fixed_end and prop_end > fixed_start:
                    print(f"  CONFLICT DETECTED!", flush=True)
                    return True
            print(f"  No conflict found", flush=True)
            return False

        # Validate and fix event IDs in the response
        validated_changes = []
        for change in moves_only:
            event_id = change.get('event_id', '')
            # Try direct ID match first
            if event_id in id_lookup:
                matched = True
            else:
                # Try matching by title as fallback
                title = change.get('event_title', '').lower()
                if title in title_lookup:
                    change['event_id'] = title_lookup[title]['id']
                    matched = True
                else:
                    matched = False

            if matched:
                # Double-check for conflicts with fixed events on the same day
                proposed_start = change.get('proposed_start', '')
                proposed_end = change.get('proposed_end', '')

                # Parse proposed times (naive local time)
                try:
                    clean_start = proposed_start.replace('Z', '').split('+')[0]
                    clean_end = proposed_end.replace('Z', '').split('+')[0]
                    current_start_str = change.get('current_start', '').replace('Z', '').split('+')[0]

                    prop_start = datetime.fromisoformat(clean_start)
                    prop_end = datetime.fromisoformat(clean_end)
                    current_start = datetime.fromisoformat(current_start_str)

                    prop_date = prop_start.date()
                    current_date = current_start.date()

                    # RULE 1: Must stay on same day
                    if prop_date != current_date:
                        continue

                    # RULE 2: Check for conflicts with fixed events on same day
                    has_conflict = False
                    for fixed in fixed_events:
                        if fixed['start'].date() != prop_date:
                            continue
                        # Check overlap
                        if prop_start < fixed['end'] and prop_end > fixed['start']:
                            has_conflict = True
                            break

                    if not has_conflict:
                        validated_changes.append(change)
                except Exception:
                    # Skip if we can't validate
                    continue

        return json.dumps({
            "success": True,
            "proposed_changes": validated_changes,
            "summary": result.get('summary', f"Found {len(validated_changes)} optimization(s)") if validated_changes else "No optimization suggestions available"
        }, indent=2)

    except json.JSONDecodeError as e:
        return json.dumps({"error": f"Failed to parse AI response: {e}"})
    except Exception as e:
        return json.dumps({"error": f"Optimization failed: {str(e)}"})


# List of tools to pass to Gemini
TOOLS = [get_calendar_events_tool, create_calendar_event_tool, find_free_time_tool, calculate_nap_time_tool, calculate_meal_windows_tool]


def load_calendar_context(user_id: str = 'default_user', days_back: int = 10) -> str:
    """
    Load calendar events from user_calendars.json and filter by date range
    
    Args:
        user_id: User ID to load calendar data for (default: 'default_user')
        days_back: Number of days to look back (default: 10)
    
    Returns:
        Formatted string with calendar events context, or empty string if no data
    """
    try:
        # Get the directory where this script is located
        script_dir = os.path.dirname(os.path.abspath(__file__))
        user_calendars_path = os.path.join(script_dir, 'user_data', f'{user_id}_calendars.json')
        
        if not os.path.exists(user_calendars_path):
            return ""
        
        # Load calendar data
        with open(user_calendars_path, 'r') as f:
            calendar_data = json.load(f)
        
        events = calendar_data.get('events', [])
        if not events:
            return ""
        
        # Calculate date range (last 90 days by default)
        now = datetime.now()
        cutoff_date = now - timedelta(days=days_back)
        
        # Filter and format events
        filtered_events = []
        for event in events:
            # Parse event start time
            start_data = event.get('start', {})
            event_start = None
            
            if 'dateTime' in start_data:
                dt_str = start_data['dateTime']
                # Handle 'Z' timezone indicator (UTC)
                if dt_str.endswith('Z'):
                    dt_str = dt_str[:-1] + '+00:00'
                try:
                    event_start = datetime.fromisoformat(dt_str)
                    # Convert to local time if timezone info present
                    if event_start.tzinfo:
                        event_start = event_start.astimezone().replace(tzinfo=None)
                except (ValueError, AttributeError):
                    # Fallback: try parsing without timezone
                    try:
                        # Remove timezone offset (everything after + or - at the end)
                        if '+' in dt_str:
                            dt_str = dt_str.split('+')[0]
                        elif dt_str.count('-') > 2:  # Has timezone offset
                            # Find the last '-' that's part of timezone (before timezone)
                            parts = dt_str.rsplit('-', 1)
                            if len(parts) == 2 and ':' in parts[1]:
                                dt_str = parts[0]
                        event_start = datetime.fromisoformat(dt_str)
                    except ValueError:
                        continue
            elif 'date' in start_data:
                try:
                    event_start = datetime.fromisoformat(start_data['date'])
                except ValueError:
                    continue
            else:
                continue
            
            # Only include events within the date range
            if event_start and event_start >= cutoff_date:
                summary = event.get('summary', 'No title')
                end_data = event.get('end', {})
                end_str = 'Unknown'
                
                if 'dateTime' in end_data:
                    dt_str = end_data['dateTime']
                    if dt_str.endswith('Z'):
                        dt_str = dt_str.replace('Z', '+00:00')
                    # ...continue with parsing dt_str as a datetime...
        # Filter and format events
        filtered_events = []
        for event in events:
            # Parse event start time
            start_data = event.get('start', {})
            event_start = None
            
            if 'dateTime' in start_data:
                dt_str = start_data['dateTime']
                # Handle 'Z' timezone indicator (UTC)
                if dt_str.endswith('Z'):
                    dt_str = dt_str[:-1] + '+00:00'
                try:
                    event_start = datetime.fromisoformat(dt_str)
                    # Convert to local time if timezone info present
                    if event_start.tzinfo:
                        event_start = event_start.astimezone().replace(tzinfo=None)
                except (ValueError, AttributeError):
                    # Fallback: try parsing without timezone
                    try:
                        # Remove timezone offset (everything after + or - at the end)
                        if '+' in dt_str:
                            dt_str = dt_str.split('+')[0]
                        elif dt_str.count('-') > 2:  # Has timezone offset
                            # Find the last '-' that's part of timezone (before timezone)
                            parts = dt_str.rsplit('-', 1)
                            if len(parts) == 2 and ':' in parts[1]:
                                dt_str = parts[0]
                        event_start = datetime.fromisoformat(dt_str)
                    except ValueError:
                        continue
            elif 'date' in start_data:
                try:
                    event_start = datetime.fromisoformat(start_data['date'])
                except ValueError:
                    continue
            else:
                continue
            
            # Only include events within the date range
            if event_start and event_start >= cutoff_date:
                summary = event.get('summary', 'No title')
                end_data = event.get('end', {})
                end_str = 'Unknown'
                
                if 'dateTime' in end_data:
                    dt_str = end_data['dateTime']
                    if dt_str.endswith('Z'):
                        dt_str = dt_str.replace('Z', '+00:00')
                    try:
                        event_end = datetime.fromisoformat(dt_str)
                        if event_end.tzinfo:
                            event_end = event_end.astimezone().replace(tzinfo=None)
                        end_str = event_end.strftime('%Y-%m-%d %H:%M')
                    except ValueError:
                        end_str = dt_str.split('T')[0] if 'T' in dt_str else 'Unknown'
                elif 'date' in end_data:
                    end_str = end_data['date']
                
                filtered_events.append({
                    'title': summary,
                    'start': event_start.strftime('%Y-%m-%d %H:%M'),
                    'end': end_str,
                    'description': event.get('description', '')
                })
        
        # Sort by start time
        filtered_events.sort(key=lambda x: x['start'])
        
        if not filtered_events:
            return ""
        
        # Format into context string
        context = f"\n\nUser's calendar events from the last {days_back} days ({len(filtered_events)} events):\n"
        for i, event in enumerate(filtered_events[:50], 1):  # Limit to 50 events to avoid token limits
            context += f"{i}. {event['title']}\n"
            context += f"   Time: {event['start']} - {event['end']}\n"
            if event['description']:
                # Truncate long descriptions
                desc = event['description'][:100] + '...' if len(event['description']) > 100 else event['description']
                context += f"   Description: {desc}\n"
            context += "\n"
        
        if len(filtered_events) > 50:
            context += f"... and {len(filtered_events) - 50} more events\n"
        
        return context
        
    except Exception as e:
        print(f"Warning: Could not load calendar context: {e}", flush=True)
        return ""


def run_query(query: str, user_id: str = 'default_user', days_back: int = 10) -> str:
    """
    Run a query through the calendar agent

    Args:
        query: Natural language query
        user_id: User ID to load calendar context for (default: 'default_user')
        days_back: Number of days to look back for calendar context (default: 10)

    Returns:
        Agent response
    """
    # Get API key - use standard Gemini API (simpler than Vertex AI)
    # Support both GEMINI_API_KEY (legacy) and GOOGLE_API_KEY
    api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')

    if not api_key:
        raise ValueError(
            "GOOGLE_API_KEY or GEMINI_API_KEY not found!\n"
            "Get one from: https://aistudio.google.com/app/apikey\n"
            "Set it: export GOOGLE_API_KEY='your-key'"
        )

    # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
    if not os.getenv('GOOGLE_API_KEY'):
        os.environ['GOOGLE_API_KEY'] = api_key

    # Load calendar context from user_calendars.json
    calendar_context = load_calendar_context(user_id=user_id, days_back=days_back)
    
    # Build the full query with calendar context
    full_query = query
    if calendar_context:
        full_query = query + calendar_context

    # Create client - will automatically use GOOGLE_API_KEY from environment
    client = genai.Client()

    # List of models to try in order (prioritize those with quota available)
    models_to_try = [
        'gemini-3-flash',          # 4/5 RPM available
        'gemini-2.5-flash',        # Available
        'gemini-2.5-flash-lite',  # Available
        'gemma-3-12b',            # Available
        'gemma-3-4b',             # Available
    ]

    last_error = None

    for model in models_to_try:
        try:
            # Use automatic function calling
            response = client.models.generate_content(
                model=model,
                contents=full_query,
                config=types.GenerateContentConfig(
                    tools=TOOLS,
                    system_instruction=SYSTEM_PROMPT,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=False
                    )
                )
            )
            return response.text

        except Exception as e:
            error_str = str(e)
            # If it's a quota error, try next model
            if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                last_error = e
                continue
            # If it's not a quota error, raise it immediately
            else:
                raise

    # If all models failed, raise the last error
    raise Exception(f"All models exhausted. Last error: {last_error}")


if __name__ == "__main__":
    # Interactive mode
    print("="*80)
    print("CALENDAR AGENT - Interactive Mode")
    print("="*80)
    print("\nExamples:")
    print("  - Show my schedule for this week")
    print("  - Schedule a 30 minute workout tomorrow at 9am")
    print("  - When am I free tomorrow?")
    print("\nType 'quit' to exit\n")

    while True:
        try:
            user_input = input("You: ").strip()

            if user_input.lower() in ['quit', 'exit', 'q']:
                print("Goodbye!")
                break

            if not user_input:
                continue

            response = run_query(user_input)
            print(f"\nAgent: {response}\n")

        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"\nError: {e}\n")