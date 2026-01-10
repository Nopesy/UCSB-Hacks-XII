"""
OAuth Setup for Google Calendar
Run this ONCE to authenticate and save credentials

Steps:
1. Get credentials.json from Google Cloud Console
2. Run this script
3. Browser opens, login with Google
4. Approve calendar access
5. token.json is saved for future use
"""

import os
import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Calendar API scope - full access to read and write
SCOPES = ['https://www.googleapis.com/auth/calendar']

def setup_oauth():
    """
    Run OAuth flow and save credentials
    """
    print("="*80)
    print("GOOGLE CALENDAR OAUTH SETUP")
    print("="*80)

    # Check if credentials.json exists
    if not os.path.exists('credentials.json'):
        print("\n❌ credentials.json not found!")
        print("\nTo get it:")
        print("1. Go to: https://console.cloud.google.com/")
        print("2. Create a project (or select existing)")
        print("3. Enable 'Google Calendar API'")
        print("4. Go to 'Credentials' → 'Create Credentials' → 'OAuth client ID'")
        print("5. Choose 'Desktop app'")
        print("6. Download JSON file")
        print("7. Rename it to 'credentials.json' and place it here")
        return False

    creds = None

    # Check if we already have a token
    if os.path.exists('token.json'):
        print("\n⚠️  token.json already exists!")
        response = input("Re-authenticate? (y/n): ").strip().lower()
        if response != 'y':
            print("Using existing token")
            return True
        os.remove('token.json')

    # Run OAuth flow
    print("\n🔐 Starting OAuth flow...")
    print("A browser window will open")
    print("Log in with your Google account and approve access")

    flow = InstalledAppFlow.from_client_secrets_file(
        'credentials.json',
        SCOPES
    )

    creds = flow.run_local_server(port=0)

    # Save credentials
    with open('token.json', 'w') as token:
        token.write(creds.to_json())

    print("\n✅ Authentication successful!")
    print("✅ token.json saved")

    # Test the connection
    print("\n🧪 Testing connection...")
    try:
        service = build('calendar', 'v3', credentials=creds)

        # Get calendar info
        calendar = service.calendars().get(calendarId='primary').execute()
        print(f"✅ Connected to calendar: {calendar.get('summary', 'Primary')}")

        # List upcoming events
        from datetime import datetime, timedelta
        now = datetime.utcnow().isoformat() + 'Z'
        week_from_now = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'

        events_result = service.events().list(
            calendarId='primary',
            timeMin=now,
            timeMax=week_from_now,
            maxResults=5,
            singleEvents=True,
            orderBy='startTime'
        ).execute()

        events = events_result.get('items', [])

        if events:
            print(f"\n📅 Found {len(events)} upcoming events:")
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                print(f"  - {event.get('summary', 'Untitled')}: {start}")
        else:
            print("\n📅 No upcoming events found")

    except Exception as e:
        print(f"❌ Error testing connection: {e}")
        return False

    print("\n" + "="*80)
    print("✅ SETUP COMPLETE")
    print("="*80)
    print("\nYou can now use the calendar agent!")
    print("Next: Run the test script to verify agent functionality")

    return True


if __name__ == "__main__":
    setup_oauth()