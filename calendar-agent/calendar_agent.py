"""
Calendar Agent using Google AI SDK directly
No LangChain dependency
"""

import os
from datetime import datetime
from google import genai
from google.genai import types
from calendar_tools import get_calendar_tool_instance


# Initialize calendar
calendar = get_calendar_tool_instance()


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
    events = calendar.get_events(days_ahead=days_ahead)

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

    result = calendar.create_event(
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
    free_slots = calendar.find_free_slots(date, duration_minutes)

    if not free_slots:
        return f"No free {duration_minutes}-minute slots found on {date.strftime('%Y-%m-%d')}"

    result = f"Free {duration_minutes}-minute slots on {date.strftime('%Y-%m-%d')}:\n\n"
    for i, (start, end) in enumerate(free_slots[:5], 1):
        result += f"{i}. {start.strftime('%H:%M')} - {end.strftime('%H:%M')}\n"

    return result


# List of tools to pass to Gemini
TOOLS = [get_calendar_events_tool, create_calendar_event_tool, find_free_time_tool]




def run_query(query: str) -> str:
    """
    Run a query through the calendar agent

    Args:
        query: Natural language query

    Returns:
        Agent response
    """
    # Get API key - use standard Gemini API (simpler than Vertex AI)
    api_key = os.getenv('GEMINI_API_KEY')

    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY not found!\n"
            "Get one from: https://aistudio.google.com/app/apikey\n"
            "Set it: export GEMINI_API_KEY='your-key'"
        )

    # Create client with standard Gemini API
    client = genai.Client(api_key=api_key)

    # List of models to try in order (prioritize those with quota available)
    models_to_try = [
        'models/gemini-2.5-flash-lite',  # 0/10 requests available
        'models/gemini-3-flash',         # 0/5 requests available
        'models/gemma-3-12b-it',         # 0/30 requests available
        'models/gemma-3-4b-it',          # 0/30 requests available
        'models/gemini-2.5-flash',       # 6/5 (over quota but try anyway)
    ]

    last_error = None

    for model in models_to_try:
        try:
            # Use automatic function calling
            response = client.models.generate_content(
                model=model,
                contents=query,
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