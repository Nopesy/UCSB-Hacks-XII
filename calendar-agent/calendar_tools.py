"""
Calendar Tools Module
Core functions for reading and writing Google Calendar
Uses token.json for authentication
"""

import os
import json
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


class CalendarTools:
    """
    Wrapper for Google Calendar API operations
    """

    def __init__(self, token_path='token.json'):
        """
        Initialize with saved credentials
        """
        # Make path relative to this file's directory if not absolute
        if not os.path.isabs(token_path):
            script_dir = os.path.dirname(os.path.abspath(__file__))
            token_path = os.path.join(script_dir, token_path)

        if not os.path.exists(token_path):
            raise FileNotFoundError(
                f"{token_path} not found! Run oauth_setup.py first from the calendar-agent directory."
            )

        # Load credentials
        creds = Credentials.from_authorized_user_file(token_path)

        # Build service
        self.service = build('calendar', 'v3', credentials=creds)

    def get_events(self, days_ahead=7, max_results=10):
        """
        Get upcoming events

        Args:
            days_ahead: How many days to look ahead
            max_results: Maximum number of events to return

        Returns:
            List of event dictionaries
        """
        try:
            now = datetime.utcnow().isoformat() + 'Z'
            end_time = (datetime.utcnow() + timedelta(days=days_ahead)).isoformat() + 'Z'

            events_result = self.service.events().list(
                calendarId='primary',
                timeMin=now,
                timeMax=end_time,
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()

            events = events_result.get('items', [])

            # Format for easier consumption
            formatted_events = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                end = event['end'].get('dateTime', event['end'].get('date'))

                formatted_events.append({
                    'id': event['id'],
                    'title': event.get('summary', 'Untitled'),
                    'start': start,
                    'end': end,
                    'description': event.get('description', ''),
                    'location': event.get('location', '')
                })

            return formatted_events

        except HttpError as error:
            print(f'Error fetching events: {error}')
            return []

    def create_event(self, title, start_time, duration_minutes=60, description='', location=''):
        """
        Create a calendar event

        Args:
            title: Event title
            start_time: Start time (datetime object or ISO string)
            duration_minutes: Duration in minutes
            description: Event description
            location: Event location

        Returns:
            Created event dict or None if failed
        """
        try:
            # Parse start time
            if isinstance(start_time, str):
                # Try to parse ISO format
                start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            elif isinstance(start_time, datetime):
                start_dt = start_time
            else:
                raise ValueError("start_time must be datetime or ISO string")

            # Calculate end time
            end_dt = start_dt + timedelta(minutes=duration_minutes)

            # Format for Google Calendar
            event = {
                'summary': title,
                'description': description,
                'location': location,
                'start': {
                    'dateTime': start_dt.isoformat(),
                    'timeZone': 'America/Los_Angeles',  # Pacific Time
                },
                'end': {
                    'dateTime': end_dt.isoformat(),
                    'timeZone': 'America/Los_Angeles',  # Pacific Time
                },
            }

            # Create event
            created_event = self.service.events().insert(
                calendarId='primary',
                body=event
            ).execute()

            return {
                'id': created_event['id'],
                'title': created_event.get('summary'),
                'start': created_event['start'].get('dateTime'),
                'link': created_event.get('htmlLink')
            }

        except Exception as error:
            print(f'Error creating event: {error}')
            return None

    def update_event(self, event_id, **kwargs):
        """
        Update an existing event

        Args:
            event_id: ID of event to update
            **kwargs: Fields to update (title, start_time, duration_minutes, description, location)

        Returns:
            Updated event dict or None
        """
        try:
            # Get existing event
            event = self.service.events().get(
                calendarId='primary',
                eventId=event_id
            ).execute()

            # Update fields
            if 'title' in kwargs:
                event['summary'] = kwargs['title']

            if 'description' in kwargs:
                event['description'] = kwargs['description']

            if 'location' in kwargs:
                event['location'] = kwargs['location']

            if 'start_time' in kwargs:
                start_time = kwargs['start_time']
                if isinstance(start_time, str):
                    start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                else:
                    start_dt = start_time

                event['start']['dateTime'] = start_dt.isoformat()

                # Update end time if duration provided
                if 'duration_minutes' in kwargs:
                    end_dt = start_dt + timedelta(minutes=kwargs['duration_minutes'])
                    event['end']['dateTime'] = end_dt.isoformat()

            # Update on calendar
            updated_event = self.service.events().update(
                calendarId='primary',
                eventId=event_id,
                body=event
            ).execute()

            return {
                'id': updated_event['id'],
                'title': updated_event.get('summary'),
                'start': updated_event['start'].get('dateTime')
            }

        except Exception as error:
            print(f'Error updating event: {error}')
            return None

    def delete_event(self, event_id):
        """
        Delete an event

        Args:
            event_id: ID of event to delete

        Returns:
            True if successful, False otherwise
        """
        try:
            self.service.events().delete(
                calendarId='primary',
                eventId=event_id
            ).execute()
            return True

        except Exception as error:
            print(f'Error deleting event: {error}')
            return False

    def find_free_slots(self, date, duration_minutes=30):
        """
        Find free time slots on a given date

        Args:
            date: Date to search (datetime object)
            duration_minutes: Required duration

        Returns:
            List of (start_time, end_time) tuples
        """
        try:
            # Get events for that day
            day_start = datetime.combine(date, datetime.min.time())
            day_end = day_start + timedelta(days=1)

            events = self.service.events().list(
                calendarId='primary',
                timeMin=day_start.isoformat() + 'Z',
                timeMax=day_end.isoformat() + 'Z',
                singleEvents=True,
                orderBy='startTime'
            ).execute().get('items', [])

            # Build busy times list
            busy_times = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                end = event['end'].get('dateTime', event['end'].get('date'))

                start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
                end_dt = datetime.fromisoformat(end.replace('Z', '+00:00'))

                busy_times.append((start_dt, end_dt))

            # Sort by start time
            busy_times.sort()

            # Find gaps (9am-5pm work hours)
            work_start = day_start.replace(hour=9, minute=0)
            work_end = day_start.replace(hour=17, minute=0)

            free_slots = []
            current_time = work_start

            for busy_start, busy_end in busy_times:
                # If there's a gap before this busy time
                if current_time + timedelta(minutes=duration_minutes) <= busy_start:
                    free_slots.append((current_time, busy_start))
                current_time = max(current_time, busy_end)

            # Check time after last event
            if current_time + timedelta(minutes=duration_minutes) <= work_end:
                free_slots.append((current_time, work_end))

            return free_slots

        except Exception as error:
            print(f'Error finding free slots: {error}')
            return []


# Helper function for LangChain tools
def get_calendar_tool_instance():
    """
    Get a CalendarTools instance (singleton pattern for the module)
    """
    if not hasattr(get_calendar_tool_instance, '_instance'):
        get_calendar_tool_instance._instance = CalendarTools()
    return get_calendar_tool_instance._instance
