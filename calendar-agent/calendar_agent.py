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


def calculate_nap_time_tool(date_str: str, user_id: str = 'default_user', 
                            sleep_time: str = '00:00', wake_time: str = '08:00') -> str:
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
        
        # Get events from user_calendars.json instead of calendar tool
        script_dir = os.path.dirname(os.path.abspath(__file__))
        user_calendars_path = os.path.join(script_dir, 'user_data', f'{user_id}_calendars.json')
        
        day_events = []
        if os.path.exists(user_calendars_path):
            try:
                with open(user_calendars_path, 'r') as f:
                    calendar_data = json.load(f)
                    all_events = calendar_data.get('events', [])
                    
                    # Filter events for the target date
                    for event in all_events:
                        start_data = event.get('start', {})
                        if isinstance(start_data, dict):
                            event_start_str = start_data.get('dateTime') or start_data.get('date')
                        else:
                            event_start_str = str(start_data)
                        
                        if event_start_str:
                            try:
                                # Handle timezone formats
                                dt_str = event_start_str
                                if dt_str.endswith('Z'):
                                    dt_str = dt_str[:-1] + '+00:00'
                                event_dt = datetime.fromisoformat(dt_str)
                                if event_dt.tzinfo:
                                    event_dt = event_dt.astimezone().replace(tzinfo=None)
                                
                                # Check if event is on target date
                                if event_dt.date() == target_date:
                                    end_data = event.get('end', {})
                                    if isinstance(end_data, dict):
                                        event_end_str = end_data.get('dateTime') or end_data.get('date')
                                    else:
                                        event_end_str = str(end_data) if end_data else None
                                    
                                    if event_end_str:
                                        if event_end_str.endswith('Z'):
                                            event_end_str = event_end_str[:-1] + '+00:00'
                                        event_end = datetime.fromisoformat(event_end_str)
                                        if event_end.tzinfo:
                                            event_end = event_end.astimezone().replace(tzinfo=None)
                                    else:
                                        event_end = event_dt + timedelta(hours=1)
                                    
                                    day_events.append({
                                        'title': event.get('summary', 'Event'),
                                        'start': event_dt,
                                        'end': event_end,
                                        'description': event.get('description', '')
                                    })
                            except (ValueError, AttributeError):
                                continue
            except Exception as e:
                print(f"Warning: Could not load calendar data: {e}", flush=True)
        
        # If calendar tool is available, also try to get events from it
        try:
            cal = get_calendar()
            if cal:
                tool_events = cal.get_events(days_ahead=max(days_diff + 1, 1))
                for event in tool_events:
                    event_start = event.get('start', '')
                    if isinstance(event_start, str):
                        try:
                            dt_str = event_start
                            if dt_str.endswith('Z'):
                                dt_str = dt_str[:-1] + '+00:00'
                            event_dt = datetime.fromisoformat(dt_str)
                            if event_dt.tzinfo:
                                event_dt = event_dt.astimezone().replace(tzinfo=None)
                            
                            if event_dt.date() == target_date:
                                # Check if we already have this event
                                if not any(e['start'] == event_dt and e['title'] == event.get('title') for e in day_events):
                                    event_end_str = event.get('end', '')
                                    if isinstance(event_end_str, str):
                                        if event_end_str.endswith('Z'):
                                            event_end_str = event_end_str[:-1] + '+00:00'
                                        event_end = datetime.fromisoformat(event_end_str)
                                        if event_end.tzinfo:
                                            event_end = event_end.astimezone().replace(tzinfo=None)
                                    else:
                                        event_end = event_dt + timedelta(hours=1)
                                    
                                    day_events.append({
                                        'title': event.get('title', 'Event'),
                                        'start': event_dt,
                                        'end': event_end,
                                        'description': event.get('description', '')
                                    })
                        except (ValueError, AttributeError):
                            continue
        except Exception:
            # Calendar tool not available, that's okay - we have user_calendars.json
            pass
        
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
        
        # Try to get free slots from calendar tool if available (optional)
        try:
            cal = get_calendar()
            if cal:
                tool_slots_30 = cal.find_free_slots(
                    datetime.combine(target_date, datetime.min.time()),
                    30
                )
                tool_slots_90 = cal.find_free_slots(
                    datetime.combine(target_date, datetime.min.time()),
                    90
                )
                # Merge with calculated slots (avoid duplicates)
                for slot in tool_slots_30:
                    if slot[0].date() == target_date and slot not in free_slots_30:
                        free_slots_30.append(slot)
                for slot in tool_slots_90:
                    if slot[0].date() == target_date and slot not in free_slots_90:
                        free_slots_90.append(slot)
        except Exception:
            # Calendar tool not available, use calculated slots
            pass
        
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
        
        # List of models to try
        models_to_try = [
            'gemini-3-flash-preview',
            'models/gemini-2.5-flash-lite',
            'models/gemini-3-flash',
            'models/gemma-3-12b-it',
            'models/gemma-3-4b-it',
            'models/gemini-2.5-flash',
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
                # If it's a quota error, try next model
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    last_error = e
                    continue
                # If it's not a quota error, raise it immediately
                else:
                    raise
        
        if not gemini_response:
            raise Exception(f"All models exhausted. Last error: {last_error}")
        
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
                                sleep_time: str = '00:00', wake_time: str = '08:00') -> str:
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
        
        # Get events from user_calendars.json
        script_dir = os.path.dirname(os.path.abspath(__file__))
        user_calendars_path = os.path.join(script_dir, 'user_data', f'{user_id}_calendars.json')
        
        day_events = []
        if os.path.exists(user_calendars_path):
            try:
                with open(user_calendars_path, 'r') as f:
                    calendar_data = json.load(f)
                    all_events = calendar_data.get('events', [])
                    
                    # Filter events for the target date
                    for event in all_events:
                        start_data = event.get('start', {})
                        if isinstance(start_data, dict):
                            event_start_str = start_data.get('dateTime') or start_data.get('date')
                        else:
                            event_start_str = str(start_data)
                        
                        if event_start_str:
                            try:
                                # Handle timezone formats
                                dt_str = event_start_str
                                if dt_str.endswith('Z'):
                                    dt_str = dt_str[:-1] + '+00:00'
                                event_dt = datetime.fromisoformat(dt_str)
                                if event_dt.tzinfo:
                                    event_dt = event_dt.astimezone().replace(tzinfo=None)
                                
                                # Check if event is on target date
                                if event_dt.date() == target_date:
                                    end_data = event.get('end', {})
                                    if isinstance(end_data, dict):
                                        event_end_str = end_data.get('dateTime') or end_data.get('date')
                                    else:
                                        event_end_str = str(end_data) if end_data else None
                                    
                                    if event_end_str:
                                        if event_end_str.endswith('Z'):
                                            event_end_str = event_end_str[:-1] + '+00:00'
                                        event_end = datetime.fromisoformat(event_end_str)
                                        if event_end.tzinfo:
                                            event_end = event_end.astimezone().replace(tzinfo=None)
                                    else:
                                        event_end = event_dt + timedelta(hours=1)
                                    
                                    day_events.append({
                                        'title': event.get('summary', 'Event'),
                                        'start': event_dt,
                                        'end': event_end,
                                        'description': event.get('description', '')
                                    })
                            except (ValueError, AttributeError):
                                continue
            except Exception as e:
                print(f"Warning: Could not load calendar data: {e}", flush=True)
        
        # If calendar tool is available, also try to get events from it
        try:
            cal = get_calendar()
            if cal:
                tool_events = cal.get_events(days_ahead=max(days_diff + 1, 1))
                for event in tool_events:
                    event_start = event.get('start', '')
                    if isinstance(event_start, str):
                        try:
                            dt_str = event_start
                            if dt_str.endswith('Z'):
                                dt_str = dt_str[:-1] + '+00:00'
                            event_dt = datetime.fromisoformat(dt_str)
                            if event_dt.tzinfo:
                                event_dt = event_dt.astimezone().replace(tzinfo=None)
                            
                            if event_dt.date() == target_date:
                                # Check if we already have this event
                                if not any(e['start'] == event_dt and e['title'] == event.get('title') for e in day_events):
                                    event_end_str = event.get('end', '')
                                    if isinstance(event_end_str, str):
                                        if event_end_str.endswith('Z'):
                                            event_end_str = event_end_str[:-1] + '+00:00'
                                        event_end = datetime.fromisoformat(event_end_str)
                                        if event_end.tzinfo:
                                            event_end = event_end.astimezone().replace(tzinfo=None)
                                    else:
                                        event_end = event_dt + timedelta(hours=1)
                                    
                                    day_events.append({
                                        'title': event.get('title', 'Event'),
                                        'start': event_dt,
                                        'end': event_end,
                                        'description': event.get('description', '')
                                    })
                        except (ValueError, AttributeError):
                            continue
        except Exception:
            # Calendar tool not available, that's okay - we have user_calendars.json
            pass
        
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
        
        # List of models to try
        models_to_try = [
            'gemini-3-flash-preview',
            'models/gemini-2.5-flash-lite',
            'models/gemini-3-flash',
            'models/gemma-3-12b-it',
            'models/gemma-3-4b-it',
            'models/gemini-2.5-flash',
        ]
        
        last_error = None
        gemini_response = None
        
        for model in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=meal_prompt,
                )
                gemini_response = response.text
                break
                
            except Exception as e:
                error_str = str(e)
                # If it's a quota error, try next model
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    last_error = e
                    continue
                # If it's not a quota error, raise it immediately
                else:
                    raise
        
        if not gemini_response:
            raise Exception(f"All models exhausted. Last error: {last_error}")
        
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
                         sleep_time: str = '00:00', wake_time: str = '08:00') -> str:
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
        
        # Get events from user_calendars.json
        script_dir = os.path.dirname(os.path.abspath(__file__))
        user_calendars_path = os.path.join(script_dir, 'user_data', f'{user_id}_calendars.json')
        
        # Get events for target date and surrounding days (for context)
        day_events = []
        week_events = []
        
        if os.path.exists(user_calendars_path):
            try:
                with open(user_calendars_path, 'r') as f:
                    calendar_data = json.load(f)
                    all_events = calendar_data.get('events', [])
                    
                    # Get events for target date and 3 days before/after for context
                    for event in all_events:
                        start_data = event.get('start', {})
                        if isinstance(start_data, dict):
                            event_start_str = start_data.get('dateTime') or start_data.get('date')
                        else:
                            event_start_str = str(start_data)
                        
                        if event_start_str:
                            try:
                                dt_str = event_start_str
                                if dt_str.endswith('Z'):
                                    dt_str = dt_str[:-1] + '+00:00'
                                event_dt = datetime.fromisoformat(dt_str)
                                if event_dt.tzinfo:
                                    event_dt = event_dt.astimezone().replace(tzinfo=None)
                                
                                event_date = event_dt.date()
                                
                                # Calculate end time for all events
                                end_data = event.get('end', {})
                                if isinstance(end_data, dict):
                                    event_end_str = end_data.get('dateTime') or end_data.get('date')
                                else:
                                    event_end_str = str(end_data) if end_data else None
                                
                                if event_end_str:
                                    if event_end_str.endswith('Z'):
                                        event_end_str = event_end_str[:-1] + '+00:00'
                                    event_end = datetime.fromisoformat(event_end_str)
                                    if event_end.tzinfo:
                                        event_end = event_end.astimezone().replace(tzinfo=None)
                                else:
                                    event_end = event_dt + timedelta(hours=1)
                                
                                # Check if event is on target date
                                if event_date == target_date:
                                    day_events.append({
                                        'title': event.get('summary', 'Event'),
                                        'start': event_dt,
                                        'end': event_end,
                                        'description': event.get('description', '')
                                    })
                                
                                # Also collect events from 3 days before to 3 days after for context
                                days_from_target = (event_date - target_date).days
                                if -3 <= days_from_target <= 3:
                                    week_events.append({
                                        'title': event.get('summary', 'Event'),
                                        'date': event_date,
                                        'start': event_dt,
                                        'end': event_end
                                    })
                            except (ValueError, AttributeError):
                                continue
            except Exception as e:
                print(f"Warning: Could not load calendar data: {e}", flush=True)
        
        # Sort events by start time
        day_events.sort(key=lambda x: x['start'])
        week_events.sort(key=lambda x: (x['date'], x['start']))
        
        # Format schedule for Gemini prompt
        schedule_text = ""
        if day_events:
            schedule_text = f"\n\n📅 SCHEDULE FOR {target_date.strftime('%A, %B %d, %Y')}:\n\n"
            total_hours = 0
            for event in day_events:
                start_time = event['start'].strftime('%I:%M %p')
                end_time = event['end'].strftime('%I:%M %p')
                duration = (event['end'] - event['start']).total_seconds() / 3600
                total_hours += duration
                schedule_text += f"• {start_time} - {end_time}: {event['title']} ({duration:.1f}h)\n"
            schedule_text += f"\nTotal scheduled time: {total_hours:.1f} hours\n"
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
        burnout_prompt = f"""You are a burnout and stress analysis expert using evidence-based research to predict burnout risk.

{schedule_text}

{week_context}

😴 USER'S SLEEP SCHEDULE:
- Bedtime: {sleep_time_str}
- Wake time: {wake_time_str}
- Sleep duration: {sleep_duration:.1f} hours

🧠 BURNOUT PREDICTION FACTORS (Based on ATUS 2024 research and stress science):

1. **Schedule Density**:
   - High event density (back-to-back meetings, no breaks) increases stress
   - Long work hours (>8 hours) correlate with higher burnout
   - Fragmented schedules increase tiredness by 63%

2. **Sleep Quality**:
   - Optimal sleep: 7-8 hours
   - People with <6 hours report 65% higher sadness
   - Sleep duration: {sleep_duration:.1f} hours

3. **Event Types**:
   - High-stakes events (exams, presentations, deadlines) increase stress
   - Social activities can improve mood
   - Exercise correlates with better well-being

4. **Time Management**:
   - Lack of buffer time between events increases stress
   - No time for meals or breaks is a red flag
   - Overcommitment leads to burnout

5. **Burnout Score Scale (0-100)**:
   - 0-30: Low risk (stable, well-balanced schedule)
   - 31-50: Moderate risk (building stress, some concerns)
   - 51-70: High risk (stress building, schedule overloaded)
   - 71-100: Critical risk (high burnout risk, immediate attention needed)

**TASK**: Analyze the user's schedule for {target_date.strftime('%A, %B %d, %Y')} and predict their burnout risk score.

**IMPORTANT**: You MUST return ONLY valid JSON in this exact format (no markdown, no code blocks, just pure JSON):

{{
  "score": 0-100 (integer, burnout risk score),
  "status": "stable" or "building" or "high-risk" or "critical",
  "reasoning": "Brief explanation of the score and key factors",
  "key_factors": [
    "Factor 1 that influenced the score",
    "Factor 2 that influenced the score",
    "Factor 3 that influenced the score"
  ],
  "recommendations": [
    "Recommendation 1 to reduce burnout risk",
    "Recommendation 2 to reduce burnout risk"
  ]
}}

Be specific and evidence-based in your analysis. Consider schedule density, sleep duration, event types, and time management."""
        
        # Get API key and set up Gemini client
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        
        if not api_key:
            return json.dumps({"error": "GOOGLE_API_KEY or GEMINI_API_KEY not found. Cannot predict burnout."})
        
        # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key
        
        # Create Gemini client
        client = genai.Client()
        
        # List of models to try
        models_to_try = [
            'gemini-3-flash-preview',
            'models/gemini-2.5-flash-lite',
            'models/gemini-3-flash',
            'models/gemma-3-12b-it',
            'models/gemma-3-4b-it',
            'models/gemini-2.5-flash',
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
                # If it's a quota error, try next model
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    last_error = e
                    continue
                # If it's not a quota error, raise it immediately
                else:
                    raise
        
        if not gemini_response:
            raise Exception(f"All models exhausted. Last error: {last_error}")
        
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
            score = max(0, min(100, score))  # Clamp to 0-100
            
            # Ensure status is valid
            status = prediction_data.get('status', 'building')
            if status not in ['stable', 'building', 'high-risk', 'critical']:
                # Determine status from score
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
                               days_ahead: int = 14) -> str:
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
        
        if os.path.exists(user_calendars_path):
            try:
                with open(user_calendars_path, 'r') as f:
                    calendar_data = json.load(f)
                    all_events = calendar_data.get('events', [])
                    
                    for event in all_events:
                        start_data = event.get('start', {})
                        if isinstance(start_data, dict):
                            event_start_str = start_data.get('dateTime') or start_data.get('date')
                        else:
                            event_start_str = str(start_data)
                        
                        if event_start_str:
                            try:
                                dt_str = event_start_str
                                if dt_str.endswith('Z'):
                                    dt_str = dt_str[:-1] + '+00:00'
                                event_dt = datetime.fromisoformat(dt_str)
                                if event_dt.tzinfo:
                                    event_dt = event_dt.astimezone().replace(tzinfo=None)
                                
                                event_date = event_dt.date()
                                
                                if event_date in events_by_date:
                                    end_data = event.get('end', {})
                                    if isinstance(end_data, dict):
                                        event_end_str = end_data.get('dateTime') or end_data.get('date')
                                    else:
                                        event_end_str = str(end_data) if end_data else None
                                    
                                    if event_end_str:
                                        if event_end_str.endswith('Z'):
                                            event_end_str = event_end_str[:-1] + '+00:00'
                                        event_end = datetime.fromisoformat(event_end_str)
                                        if event_end.tzinfo:
                                            event_end = event_end.astimezone().replace(tzinfo=None)
                                    else:
                                        event_end = event_dt + timedelta(hours=1)
                                    
                                    events_by_date[event_date].append({
                                        'title': event.get('summary', 'Event'),
                                        'start': event_dt,
                                        'end': event_end,
                                        'description': event.get('description', '')
                                    })
                            except (ValueError, AttributeError):
                                continue
            except Exception as e:
                print(f"Warning: Could not load calendar data: {e}", flush=True)
        
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
            
            if day_events:
                schedules_text += f"\n\n📅 {target_date.strftime('%A, %B %d, %Y')}:\n"
                total_hours = 0
                for event in day_events:
                    start_time = event['start'].strftime('%I:%M %p')
                    end_time = event['end'].strftime('%I:%M %p')
                    duration = (event['end'] - event['start']).total_seconds() / 3600
                    total_hours += duration
                    schedules_text += f"  • {start_time} - {end_time}: {event['title']} ({duration:.1f}h)\n"
                schedules_text += f"  Total scheduled: {total_hours:.1f} hours\n"
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
        burnout_prompt = f"""You are a burnout and stress analysis expert using evidence-based research to predict burnout risk.

{historical_context}

{schedules_text}

😴 USER'S SLEEP SCHEDULE:
- Bedtime: {sleep_time_str}
- Wake time: {wake_time_str}
- Sleep duration: {sleep_duration:.1f} hours

🧠 BURNOUT PREDICTION FACTORS (Based on ATUS 2024 research and stress science):

1. **Schedule Density**:
   - High event density (back-to-back meetings, no breaks) increases stress
   - Long work hours (>8 hours) correlate with higher burnout
   - Fragmented schedules increase tiredness by 63%

2. **Sleep Quality**:
   - Optimal sleep: 7-8 hours
   - People with <6 hours report 65% higher sadness
   - Sleep duration: {sleep_duration:.1f} hours

3. **Event Types**:
   - High-stakes events (exams, presentations, deadlines) increase stress
   - Social activities can improve mood
   - Exercise correlates with better well-being

4. **Time Management**:
   - Lack of buffer time between events increases stress
   - No time for meals or breaks is a red flag
   - Overcommitment leads to burnout

5. **CUMULATIVE BURNOUT & RECOVERY EFFECTS** (CRITICAL):
   - **Recovery Days**: If the user has had 2+ consecutive days with low burnout scores (0-30), they have built up resilience. Even if a day has a packed schedule, the burnout score should be LOWER than it would normally be because recovery days provide a buffer.
   - **Cumulative Stress**: If the user has had 2+ consecutive days with high burnout scores (50+), they are more vulnerable. A packed schedule on the next day should result in a HIGHER burnout score than normal because stress compounds.
   - **Recovery Pattern**: After several low-stress days, a moderately busy day should score lower. After several high-stress days, even a moderately busy day should score higher.
   - **Day-by-Day Progression**: Consider how burnout scores should progress day by day. If Day 1 has score 25 (low), Day 2 has score 28 (low), then Day 3 with a packed schedule might score 35-40 (moderate) instead of 50+ (high) because of the recovery buffer.
   - **Reset Effect**: If there's a significant gap in historical data or the user had a very low-stress day, consider it a reset point.

6. **Burnout Score Scale (0-100)**:
   - 0-30: Low risk (stable, well-balanced schedule)
   - 31-50: Moderate risk (building stress, some concerns)
   - 51-70: High risk (stress building, schedule overloaded)
   - 71-100: Critical risk (high burnout risk, immediate attention needed)

**TASK**: Analyze the user's schedules for the next {days_ahead} days (from {date_range[0].strftime('%B %d, %Y')} to {date_range[-1].strftime('%B %d, %Y')}) and predict burnout risk scores for EACH day.

**IMPORTANT**: When calculating scores, you MUST consider the cumulative burnout and recovery effects described above. If recent days had low burnout, apply a recovery buffer. If recent days had high burnout, apply cumulative stress effects. Predict scores day-by-day in chronological order, with each day's score influencing the next.

**CRITICAL INSTRUCTIONS FOR CUMULATIVE BURNOUT**:
1. Calculate predictions SEQUENTIALLY, day by day in chronological order.
2. For each day, consider:
   - The schedule density and events for that specific day
   - The burnout scores of PREVIOUS days (both from historical context and from earlier days in this prediction batch)
   - Apply recovery buffer if recent days were low-stress
   - Apply cumulative stress if recent days were high-stress
3. Example: If Day 1 scores 25 (low), Day 2 scores 28 (low), then Day 3 with a packed schedule should score 35-40 (moderate) instead of 50+ (high) because the user has recovery buffer.
4. Example: If Day 1 scores 65 (high), Day 2 scores 70 (high), then Day 3 with a moderately busy schedule should score 60-65 (high) instead of 45-50 (moderate) because cumulative stress makes the user more vulnerable.

**IMPORTANT**: You MUST return ONLY valid JSON in this exact format (no markdown, no code blocks, just pure JSON):

{{
  "predictions": [
    {{
      "date": "YYYY-MM-DD",
      "score": 0-100 (integer, burnout risk score),
      "status": "stable" or "building" or "high-risk" or "critical",
      "reasoning": "Brief explanation including how previous days' burnout influenced this score"
    }},
    ... (one entry for each day, in chronological order)
  ]
}}

Return predictions for ALL {days_ahead} days in chronological order. Each day's score should reflect cumulative burnout effects from previous days. Be specific and evidence-based in your analysis."""
        
        # Get API key and set up Gemini client
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
        
        if not api_key:
            return json.dumps({"error": "GOOGLE_API_KEY or GEMINI_API_KEY not found. Cannot predict burnout."})
        
        # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key
        
        # Create Gemini client
        client = genai.Client()
        
        # List of models to try
        models_to_try = [
            'gemini-3-flash-preview',
            'models/gemini-2.5-flash-lite',
            'models/gemini-3-flash',
            'models/gemma-3-12b-it',
            'models/gemma-3-4b-it',
            'models/gemini-2.5-flash',
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
                # If it's a quota error, try next model
                if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                    last_error = e
                    continue
                # If it's not a quota error, raise it immediately
                else:
                    raise
        
        if not gemini_response:
            raise Exception(f"All models exhausted. Last error: {last_error}")
        
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
                score = max(0, min(100, score))  # Clamp to 0-100
                
                status = pred.get('status', 'building')
                if status not in ['stable', 'building', 'high-risk', 'critical']:
                    # Determine status from score
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
        'gemini-3-flash-preview',        # User's preferred model
        'models/gemini-2.5-flash-lite',  # 0/10 requests available
        'models/gemini-3-flash',         # 0/5 requests available
        'models/gemma-3-12b-it',         # 0/30 requests available
        'models/gemma-3-4b-it',          # 0/30 requests available
        'models/gemini-2.5-flash',        # 6/5 (over quota but try anyway)
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