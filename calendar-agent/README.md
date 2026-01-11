# Calendar Agent

AI-powered calendar assistant that connects to Google Calendar and uses Gemini AI for natural language schedule management.

## Features

- **Natural Language Processing**: Create, modify, and query calendar events using conversational commands
- **Google Calendar Integration**: Full OAuth 2.0 integration with Google Calendar API
- **Schedule Optimization**: Uses ATUS 2024 data insights for evidence-based scheduling recommendations
- **Multi-Calendar Support**: Sync and manage multiple Google calendars
- **Event Management**: Create, update, delete, and search calendar events

## Setup

### Prerequisites

- Python 3.8+
- Google Cloud Project with Calendar API enabled
- Gemini API key

### Installation

1. Install dependencies:
```bash
pip install -r ../requirements.txt
```

2. Set up Google Calendar API credentials:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a project and enable Google Calendar API
   - Create OAuth 2.0 credentials (Desktop app)
   - Download credentials and save as `credentials.json` in the calendar-agent directory

3. Set up environment variables:
```bash
# Create .env file in project root
GEMINI_API_KEY=your_gemini_api_key_here
```

4. Run OAuth setup (one-time):
```bash
python oauth_setup.py
```

## Usage

### Running the Calendar Agent

```bash
python calendar_agent.py
```

Example commands:
- "Schedule a team meeting tomorrow at 2pm"
- "What's on my calendar this week?"
- "Move my dentist appointment to next Tuesday"

### Running the API Server

The Flask API server provides OAuth and calendar sync endpoints for the frontend:

```bash
python api_server.py
```

API runs on `http://localhost:5001`

**Endpoints:**
- `GET /api/health` - Health check
- `POST /api/oauth/initiate` - Start OAuth flow
- `GET /oauth/callback` - OAuth callback handler
- `POST /api/calendars/list` - List user's calendars
- `POST /api/calendars/sync` - Sync selected calendars and fetch events
- `POST /api/auth/status` - Check authentication status

## File Structure

- `calendar_agent.py` - Main agent with Gemini AI integration
- `calendar_tools.py` - Google Calendar API wrapper
- `api_server.py` - Flask API for OAuth and frontend integration
- `test_agent.py` - Test script for agent functionality
- `user_data/` - User tokens and synced calendar data (gitignored)

## Configuration

The agent uses Pacific Time (America/Los_Angeles) by default. All times are interpreted in this timezone.

- `NODE_API_URL` (optional): URL of the Node API to POST synced events to (default `http://localhost:3001`).
- `CAL_AGENT_CHUNK_SIZE` (optional): number of events per POST when syncing large calendars (default `500`).

## Security Notes

- Never commit `credentials.json`, `token.json`, or any files in `user_data/`
- These files contain sensitive API keys and OAuth tokens
- Add them to .gitignore (already configured)