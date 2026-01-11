# UCSB Hacks XII - Calendar Management System

A comprehensive calendar management system with AI-powered scheduling, sleep tracking, and burnout prevention features.

## Project Structure

```
.
├── calendar-agent/          # AI-powered calendar agent (Python)
│   ├── calendar_agent.py   # Main Gemini AI agent
│   ├── calendar_tools.py   # Google Calendar API wrapper
│   ├── api_server.py       # Flask API for OAuth/frontend integration
│   └── README.md           # Calendar agent documentation
├── models/                  # MongoDB models
│   └── SleepEntry.js       # Sleep tracking model
├── server.js               # Express API server (Node.js)
├── UCSB-Hacks-XII-FrontEnd/ # React frontend (Vite)
└── README.md               # This file
```

## Features

### Calendar Agent
- 🤖 **AI-Powered Scheduling**: Natural language calendar management using Gemini AI
- 📅 **Google Calendar Integration**: Full OAuth 2.0 integration with multi-calendar support
- 📊 **Evidence-Based Insights**: Uses ATUS 2024 data for schedule optimization
- 🔄 **Event Sync**: Automatic synchronization of calendar events

### Sleep Tracking
- 😴 **Sleep Entry Management**: Track daily sleep and wake times
- 📈 **MongoDB Storage**: Persistent sleep data storage
- 🌐 **RESTful API**: Easy integration with frontend

### Frontend
- ⚛️ **React + Vite**: Modern, fast frontend development
- 🎨 **Responsive UI**: Clean calendar interface
- 🔐 **OAuth Integration**: Seamless Google Calendar authentication

## Quick Start

### Prerequisites
- Python 3.8+
- Node.js 16+
- MongoDB Atlas account (or local MongoDB)
- Google Cloud Project with Calendar API enabled
- Gemini API key

### 1. Clone and Setup

```bash
git clone <repo-url>
cd Hackathon
```

### 2. Backend Setup (Python Calendar Agent)

```bash
# Install Python dependencies
pip install -r requirements.txt

# Configure credentials
cp calendar-agent/credentials.json.example calendar-agent/credentials.json
# Edit credentials.json with your Google OAuth credentials

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run OAuth setup (one-time)
cd calendar-agent
python oauth_setup.py
cd ..

# Start Flask API server (port 5001)
cd calendar-agent
python api_server.py
```

### 3. Backend Setup (Node.js Sleep API)

```bash
# Install Node dependencies
npm install

# Start Express server (port 3001)
npm start
```

### 4. Frontend Setup

```bash
cd UCSB-Hacks-XII-FrontEnd
npm install
npm run dev
```

Frontend will run on `http://localhost:5173`

## API Documentation

### Calendar Agent API (Flask - Port 5001)

- `GET /api/health` - Health check
- `POST /api/oauth/initiate` - Initiate Google OAuth flow
- `GET /oauth/callback` - OAuth callback handler
- `POST /api/calendars/list` - List user's Google calendars
- `POST /api/calendars/sync` - Sync calendars and fetch events
- `POST /api/auth/status` - Check authentication status

### Sleep Tracking API (Express - Port 3001)

- `GET /api/health` - Health check
- `GET /api/sleep/today` - Get today's sleep entry
- `POST /api/sleep` - Create/update sleep entry

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
MONGODB_URI=your_mongodb_connection_string
PORT=3001
GEMINI_API_KEY=your_gemini_api_key
```

### Google Calendar OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create/select a project
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials (Desktop app)
5. Add authorized redirect URI: `http://localhost:5001/oauth/callback`
6. Download credentials as `credentials.json` in `calendar-agent/` directory

## Security Notes

⚠️ **Never commit sensitive files:**
- `credentials.json` - Google OAuth credentials
- `token.json` - User OAuth tokens
- `.env` - Environment variables
- `user_data/` - User calendar data

These are already in `.gitignore`

## Development

### Running in Development

Run all three services simultaneously:

1. **Terminal 1** - Calendar Agent API:
```bash
cd calendar-agent && python api_server.py
```

2. **Terminal 2** - Sleep Tracking API:
```bash
npm start
```

3. **Terminal 3** - Frontend:
```bash
cd UCSB-Hacks-XII-FrontEnd && npm run dev
```

## Tech Stack

- **Frontend**: React, Vite, TypeScript
- **Calendar Agent**: Python, Flask, Google Calendar API, Gemini AI
- **Sleep API**: Node.js, Express, MongoDB, Mongoose
- **Authentication**: OAuth 2.0 (Google)

## License

MIT
