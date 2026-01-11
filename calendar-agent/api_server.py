"""
Flask API Server for Calendar OAuth and Syncing
Minimal integration with existing frontend
"""

from flask import Flask, request, jsonify, redirect, session
from flask_cors import CORS
import os
import json
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google import genai
from calendar_agent import calculate_nap_time_tool, calculate_meal_windows_tool, predict_burnout_tool, predict_burnout_batch_tool, load_burnout_cache
import secrets

# Allow HTTP for local development (disable HTTPS requirement)
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
CORS(app, supports_credentials=True)

# OAuth configuration
SCOPES = ['https://www.googleapis.com/auth/calendar']
CLIENT_SECRETS_FILE = "credentials.json"
REDIRECT_URI = "http://localhost:5001/oauth/callback"

# Storage paths
USERS_DIR = "user_data"
os.makedirs(USERS_DIR, exist_ok=True)

# In-memory store for OAuth states (since session doesn't work with popups)
oauth_states = {}


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "ok"})


@app.route('/api/oauth/initiate', methods=['POST'])
def oauth_initiate():
    """
    Initiate OAuth flow
    Returns authorization URL for frontend to redirect to
    """
    try:
        data = request.json
        user_id = data.get('user_id', 'default_user')

        # Check if credentials file exists
        if not os.path.exists(CLIENT_SECRETS_FILE):
            error_msg = f"Credentials file '{CLIENT_SECRETS_FILE}' not found. Please create it from Google Cloud Console."
            print(f"ERROR: {error_msg}", flush=True)
            return jsonify({"error": error_msg}), 500

        # Store user_id in session
        session['user_id'] = user_id

        # Create flow
        flow = Flow.from_client_secrets_file(
            CLIENT_SECRETS_FILE,
            scopes=SCOPES,
            redirect_uri=REDIRECT_URI
        )

        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'  # Force re-consent to update scopes
        )

        # Store state and user_id in memory (session doesn't work with popups)
        oauth_states[state] = user_id

        return jsonify({
            "authorization_url": authorization_url,
            "state": state
        })

    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"ERROR in oauth_initiate: {error_msg}", flush=True)
        print(f"Traceback: {traceback.format_exc()}", flush=True)
        return jsonify({"error": error_msg}), 500


@app.route('/oauth/callback', methods=['GET'])
def oauth_callback():
    """
    OAuth callback handler
    Exchanges code for tokens and saves them
    """
    import sys
    try:
        print("DEBUG: Entered oauth_callback", flush=True)
        sys.stdout.flush()

        # Get state from query params
        state = request.args.get('state')
        user_id = oauth_states.get(state, 'default_user')

        print(f"DEBUG: OAuth callback - user_id={user_id}, state={state}", flush=True)
        print(f"DEBUG: oauth_states dict: {oauth_states}", flush=True)
        sys.stdout.flush()

        # Create flow
        flow = Flow.from_client_secrets_file(
            CLIENT_SECRETS_FILE,
            scopes=SCOPES,
            state=state,
            redirect_uri=REDIRECT_URI
        )

        # Disable scope validation to avoid errors from multiple authorized scopes
        # This happens when user previously authorized different scopes
        import os
        os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

        # Exchange authorization code for credentials
        flow.fetch_token(authorization_response=request.url)
        credentials = flow.credentials

        print(f"DEBUG: Got credentials, saving to user_data")

        # Save credentials to user-specific file
        user_token_path = os.path.join(USERS_DIR, f"{user_id}_token.json")
        with open(user_token_path, 'w') as token_file:
            token_file.write(credentials.to_json())

        print(f"DEBUG: Saved token to {user_token_path}")
        print(f"DEBUG: File exists: {os.path.exists(user_token_path)}")

        # Clean up state from memory
        if state in oauth_states:
            del oauth_states[state]

        # Return HTML that closes the popup window
        return """
        <html>
            <head><title>OAuth Success</title></head>
            <body>
                <script>
                    window.opener.postMessage({type: 'oauth-success'}, 'http://localhost:5173');
                    window.close();
                </script>
                <p>Authorization successful! This window should close automatically.</p>
            </body>
        </html>
        """

    except Exception as e:
        import traceback
        error_msg = str(e)
        print(f"DEBUG: Exception in oauth_callback: {error_msg}", flush=True)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", flush=True)
        sys.stdout.flush()

        return f"""
        <html>
            <head><title>OAuth Error</title></head>
            <body>
                <script>
                    window.opener.postMessage({{type: 'oauth-error', error: '{error_msg}'}}, 'http://localhost:5173');
                    window.close();
                </script>
                <p>Authorization failed: {error_msg}</p>
            </body>
        </html>
        """


@app.route('/api/calendars/list', methods=['POST'])
def list_calendars():
    """
    List all calendars for authenticated user
    """
    try:
        data = request.json
        user_id = data.get('user_id', 'default_user')

        # Load credentials
        user_token_path = os.path.join(USERS_DIR, f"{user_id}_token.json")
        if not os.path.exists(user_token_path):
            return jsonify({"error": "Not authenticated"}), 401

        creds = Credentials.from_authorized_user_file(user_token_path, SCOPES)

        # Build service
        service = build('calendar', 'v3', credentials=creds)

        # Get calendar list
        calendar_list = service.calendarList().list().execute()

        calendars = []
        for calendar in calendar_list.get('items', []):
            calendars.append({
                'id': calendar['id'],
                'summary': calendar.get('summary', 'Unnamed Calendar'),
                'description': calendar.get('description', ''),
                'primary': calendar.get('primary', False),
                'backgroundColor': calendar.get('backgroundColor', '#000000')
            })

        return jsonify({
            "calendars": calendars
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/calendars/sync', methods=['POST'])
def sync_calendars():
    """
    Save selected calendars and fetch all events from them
    """
    try:
        from datetime import datetime
        import time

        data = request.json
        user_id = data.get('user_id', 'default_user')
        selected_calendar_ids = data.get('calendar_ids', [])

        # Load credentials
        user_token_path = os.path.join(USERS_DIR, f"{user_id}_token.json")
        if not os.path.exists(user_token_path):
            return jsonify({"error": "Not authenticated"}), 401

        creds = Credentials.from_authorized_user_file(user_token_path, SCOPES)
        service = build('calendar', 'v3', credentials=creds)

        # Fetch all events from selected calendars
        all_events = []
        for calendar_id in selected_calendar_ids:
            try:
                # Fetch all events (no time limit)
                events_result = service.events().list(
                    calendarId=calendar_id,
                    maxResults=2500,  # Google's max per request
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()

                events = events_result.get('items', [])

                # Add calendar info to each event
                for event in events:
                    event['calendar_id'] = calendar_id
                    all_events.append(event)

                print(f"DEBUG: Fetched {len(events)} events from calendar {calendar_id}", flush=True)

            except Exception as e:
                print(f"DEBUG: Error fetching events from {calendar_id}: {e}", flush=True)
                continue

        # Save selected calendars and all events
        user_calendars_path = os.path.join(USERS_DIR, f"{user_id}_calendars.json")
        with open(user_calendars_path, 'w') as f:
            json.dump({
                'user_id': user_id,
                'selected_calendars': selected_calendar_ids,
                'events': all_events,
                'event_count': len(all_events),
                'synced_at': datetime.now().isoformat()
            }, f, indent=2)

        # Attempt to POST the fetched events to the Node API for persistence
        node_post_info = None
        try:
            import requests, time, math
            node_url = os.environ.get('NODE_API_URL', 'http://localhost:3001')

            # If very large number of events, POST in chunks to avoid payload-too-large errors
            CHUNK_SIZE = int(os.environ.get('CAL_AGENT_CHUNK_SIZE', 500))
            total_events = len(all_events)
            if total_events == 0:
                node_post_info = {"ok": True, "status": 204, "text": "no events to post", "batches": []}
            else:
                batches = []
                for i in range(0, total_events, CHUNK_SIZE):
                    chunk = all_events[i:i+CHUNK_SIZE]
                    payload = {"user_id": user_id, "events": chunk}

                    # Retry per chunk
                    chunk_result = None
                    for attempt in range(3):
                        try:
                            r = requests.post(f"{node_url}/api/events/sync", json=payload, timeout=30)
                            chunk_result = {"ok": r.ok, "status": r.status_code, "text": r.text}
                            if r.ok:
                                print(f"DEBUG: Posted chunk {i//CHUNK_SIZE + 1} ({len(chunk)} events) to Node API: {r.status_code}")
                                break
                            else:
                                print(f"DEBUG: Node API error on chunk {i//CHUNK_SIZE + 1}: {r.status_code} {r.text}")
                                time.sleep(1)
                        except Exception as e:
                            chunk_result = {"ok": False, "error": str(e)}
                            print(f"DEBUG: Error posting chunk {i//CHUNK_SIZE + 1} to Node API: {e}")
                            time.sleep(1)

                    batches.append({
                        "batch_index": i//CHUNK_SIZE + 1,
                        "size": len(chunk),
                        "result": chunk_result
                    })

                node_post_info = {
                    "ok": all(b.get('result', {}).get('ok') for b in batches),
                    "status": None,
                    "text": None,
                    "total_events": total_events,
                    "total_batches": len(batches),
                    "batches": batches
                }
        except Exception as e:
            node_post_info = {"ok": False, "error": str(e)}
            print(f"DEBUG: Skipping Node API post (requests not available or other error): {e}")

        return jsonify({
            "success": True,
            "message": f"Synced {len(selected_calendar_ids)} calendars with {len(all_events)} events",
            "node_post": node_post_info,
        })

    except Exception as e:
        import traceback
        print(f"DEBUG: Exception in sync_calendars: {str(e)}", flush=True)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", flush=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/calendars/synced', methods=['POST'])
def get_synced_calendars():
    """
    Return the stored selected calendars and metadata for a user
    """
    try:
        data = request.json
        user_id = data.get('user_id', 'default_user')

        user_calendars_path = os.path.join(USERS_DIR, f"{user_id}_calendars.json")
        if not os.path.exists(user_calendars_path):
            return jsonify({"selected_calendars": [], "event_count": 0, "synced_at": None})

        with open(user_calendars_path, 'r') as f:
            calendar_data = json.load(f)

        return jsonify({
            "selected_calendars": calendar_data.get('selected_calendars', []),
            "event_count": calendar_data.get('event_count', 0),
            "synced_at": calendar_data.get('synced_at')
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/auth/status', methods=['POST'])
def auth_status():
    """
    Check if user has authenticated
    """
    try:
        data = request.json
        user_id = data.get('user_id', 'default_user')

        user_token_path = os.path.join(USERS_DIR, f"{user_id}_token.json")
        user_calendars_path = os.path.join(USERS_DIR, f"{user_id}_calendars.json")

        has_token = os.path.exists(user_token_path)
        has_calendars = os.path.exists(user_calendars_path)

        synced_calendars = []
        if has_calendars:
            with open(user_calendars_path, 'r') as f:
                calendar_data = json.load(f)
                synced_calendars = calendar_data.get('selected_calendars', [])

        return jsonify({
            "authenticated": has_token,
            "has_synced_calendars": has_calendars,
            "synced_calendar_count": len(synced_calendars)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/gemini/chat', methods=['POST'])
def gemini_chat():
    """
    Chat with Gemini AI
    Accepts natural language queries and returns AI responses
    """
    try:
        data = request.json
        query = data.get('query', '')
        model = data.get('model', 'gemini-3-flash')
        user_id = data.get('user_id', 'default_user')

        if not query:
            return jsonify({"error": "Query is required"}), 400

        # Get API key - support both GEMINI_API_KEY (legacy) and GOOGLE_API_KEY
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')

        if not api_key:
            return jsonify({
                "error": "GOOGLE_API_KEY or GEMINI_API_KEY not found",
                "message": "Get one from: https://aistudio.google.com/app/apikey"
            }), 500

        # Set GOOGLE_API_KEY for genai.Client() to pick up automatically
        if not os.getenv('GOOGLE_API_KEY'):
            os.environ['GOOGLE_API_KEY'] = api_key

        # Create client - will automatically use GOOGLE_API_KEY from environment
        client = genai.Client()

        # Optionally include calendar context if user is authenticated
        context = ""
        user_calendars_path = os.path.join(USERS_DIR, f"{user_id}_calendars.json")
        if os.path.exists(user_calendars_path):
            try:
                with open(user_calendars_path, 'r') as f:
                    calendar_data = json.load(f)
                    events = calendar_data.get('events', [])
                    if events:
                        # Add recent events as context
                        recent_events = events[:10]  # Last 10 events
                        context = "\n\nUser's recent calendar events:\n"
                        for event in recent_events:
                            summary = event.get('summary', 'No title')
                            start = event.get('start', {}).get('dateTime', event.get('start', {}).get('date', 'Unknown'))
                            context += f"- {summary} at {start}\n"
            except Exception as e:
                print(f"DEBUG: Error loading calendar context: {e}", flush=True)

        # Build the prompt with optional context
        full_query = query
        if context:
            full_query = f"{query}\n{context}"

        # Generate response using Gemini
        response = client.models.generate_content(
            model=model,
            contents=full_query,
        )

        return jsonify({
            "success": True,
            "response": response.text,
            "model": model
        })

    except Exception as e:
        import traceback
        print(f"DEBUG: Exception in gemini_chat: {str(e)}", flush=True)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", flush=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/nap-times/calculate', methods=['POST'])
def calculate_nap_times():
    """
    Calculate optimal nap times for a given date
    Returns JSON array of suggested nap events that can be appended to calendar
    """
    try:
        data = request.json
        date_str = data.get('date')  # ISO format 'YYYY-MM-DD'
        user_id = data.get('user_id', 'default_user')
        sleep_time = data.get('sleep_time', '00:00')  # 24-hour format 'HH:MM', default midnight
        wake_time = data.get('wake_time', '08:00')  # 24-hour format 'HH:MM', default 8 AM

        if not date_str:
            return jsonify({"error": "Date is required (format: YYYY-MM-DD)"}), 400

        # Validate time formats
        try:
            # Validate sleep_time format
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            if not (0 <= sleep_hour <= 23 and 0 <= sleep_minute <= 59):
                return jsonify({"error": "Invalid sleep_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
            
            # Validate wake_time format
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            if not (0 <= wake_hour <= 23 and 0 <= wake_minute <= 59):
                return jsonify({"error": "Invalid wake_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
        except (ValueError, AttributeError):
            return jsonify({"error": "Invalid time format. Use 24-hour format 'HH:MM' (e.g., '00:00' or '08:00')"}), 400

        # Check if events are provided in request (from MongoDB)
        provided_events = data.get('events', None)
        
        # Call the calculate_nap_time_tool function
        if provided_events:
            # Use provided events from MongoDB
            result_json = calculate_nap_time_tool(date_str, user_id=user_id, 
                                                 sleep_time=sleep_time, wake_time=wake_time,
                                                 provided_events=provided_events)
        else:
            # Load from JSON files (legacy)
            result_json = calculate_nap_time_tool(date_str, user_id=user_id, 
                                                 sleep_time=sleep_time, wake_time=wake_time)
        
        # Parse the JSON response
        result_data = json.loads(result_json)
        
        # Check if there's an error
        if 'error' in result_data:
            return jsonify(result_data), 500
        
        # Return the nap recommendations as JSON
        return jsonify({
            "success": True,
            "date": date_str,
            "events": result_data.get('events', []),
            "summary": result_data.get('summary', ''),
            "count": result_data.get('count', 0)
        })

    except json.JSONDecodeError as e:
        return jsonify({
            "error": "Failed to parse nap time calculation result",
            "details": str(e)
        }), 500
    except Exception as e:
        import traceback
        print(f"DEBUG: Exception in calculate_nap_times: {str(e)}", flush=True)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", flush=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/meal-windows/calculate', methods=['POST'])
def calculate_meal_windows():
    """
    Calculate optimal meal windows for a given date
    Returns JSON array of suggested meal events that can be appended to calendar
    """
    try:
        data = request.json
        date_str = data.get('date')  # ISO format 'YYYY-MM-DD'
        user_id = data.get('user_id', 'default_user')
        sleep_time = data.get('sleep_time', '00:00')  # 24-hour format 'HH:MM', default midnight
        wake_time = data.get('wake_time', '08:00')  # 24-hour format 'HH:MM', default 8 AM

        if not date_str:
            return jsonify({"error": "Date is required (format: YYYY-MM-DD)"}), 400

        # Validate time formats
        try:
            # Validate sleep_time format
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            if not (0 <= sleep_hour <= 23 and 0 <= sleep_minute <= 59):
                return jsonify({"error": "Invalid sleep_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
            
            # Validate wake_time format
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            if not (0 <= wake_hour <= 23 and 0 <= wake_minute <= 59):
                return jsonify({"error": "Invalid wake_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
        except (ValueError, AttributeError):
            return jsonify({"error": "Invalid time format. Use 24-hour format 'HH:MM' (e.g., '00:00' or '08:00')"}), 400

        # Check if events are provided in request (from MongoDB)
        provided_events = data.get('events', None)
        
        # Call the calculate_meal_windows_tool function
        if provided_events:
            # Use provided events from MongoDB
            result_json = calculate_meal_windows_tool(date_str, user_id=user_id, 
                                                     sleep_time=sleep_time, wake_time=wake_time,
                                                     provided_events=provided_events)
        else:
            # Load from JSON files (legacy)
            result_json = calculate_meal_windows_tool(date_str, user_id=user_id, 
                                                     sleep_time=sleep_time, wake_time=wake_time)
        
        # Parse the JSON response
        result_data = json.loads(result_json)
        
        # Check if there's an error
        if 'error' in result_data:
            return jsonify(result_data), 500
        
        # Return the meal recommendations as JSON
        return jsonify({
            "success": True,
            "date": date_str,
            "events": result_data.get('events', []),
            "summary": result_data.get('summary', ''),
            "count": result_data.get('count', 0)
        })

    except json.JSONDecodeError as e:
        return jsonify({
            "error": "Failed to parse meal window calculation result",
            "details": str(e)
        }), 500
    except Exception as e:
        import traceback
        print(f"DEBUG: Exception in calculate_meal_windows: {str(e)}", flush=True)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", flush=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/burnout/predict', methods=['POST'])
def predict_burnout():
    """
    Predict burnout score for a given date
    Uses cached predictions if available, otherwise calculates for next 14 days
    Returns JSON with burnout score (0-100), status, reasoning, and recommendations
    """
    try:
        from datetime import datetime, timedelta
        
        data = request.json
        date_str = data.get('date')  # ISO format 'YYYY-MM-DD'
        user_id = data.get('user_id', 'default_user')
        sleep_time = data.get('sleep_time', '00:00')  # 24-hour format 'HH:MM', default midnight
        wake_time = data.get('wake_time', '08:00')  # 24-hour format 'HH:MM', default 8 AM

        if not date_str:
            return jsonify({"error": "Date is required (format: YYYY-MM-DD)"}), 400

        # Validate time formats
        try:
            # Validate sleep_time format
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            if not (0 <= sleep_hour <= 23 and 0 <= sleep_minute <= 59):
                return jsonify({"error": "Invalid sleep_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
            
            # Validate wake_time format
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            if not (0 <= wake_hour <= 23 and 0 <= wake_minute <= 59):
                return jsonify({"error": "Invalid wake_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
        except (ValueError, AttributeError):
            return jsonify({"error": "Invalid time format. Use 24-hour format 'HH:MM' (e.g., '00:00' or '08:00')"}), 400

        # Check cache first (ensure we're using the correct user_id)
        cache = load_burnout_cache(user_id=user_id)
        print(f"DEBUG: Loading cache for user_id={user_id}, cache keys: {list(cache.keys())[:5]}...", flush=True)
        
        # Check if we need to refresh cache (if date is not in cache or cache is outdated)
        today = datetime.now().date()
        target_date = datetime.fromisoformat(date_str).date()
        days_ahead = (target_date - today).days
        
        # If date is not in cache or more than 14 days ahead, calculate batch
        needs_refresh = False
        if date_str not in cache:
            needs_refresh = True
        else:
            # Check if cache covers next 14 days
            cache_dates = set(cache.keys())
            expected_dates = set()
            for i in range(14):
                expected_date = (today + timedelta(days=i)).isoformat()
                expected_dates.add(expected_date)
            
            if not expected_dates.issubset(cache_dates):
                needs_refresh = True
        
        # Check if events are provided in request (from MongoDB)
        provided_events = data.get('events', None)
        
        # If cache needs refresh, calculate for next 14 days
        if needs_refresh:
            print(f"DEBUG: Refreshing burnout cache for next 14 days", flush=True)
            batch_result_json = predict_burnout_batch_tool(
                user_id=user_id,
                sleep_time=sleep_time,
                wake_time=wake_time,
                days_ahead=14,
                provided_events=provided_events
            )
            batch_result = json.loads(batch_result_json)
            
            if 'error' in batch_result:
                # Fallback to single date prediction
                print(f"DEBUG: Batch prediction failed, falling back to single date", flush=True)
                result_json = predict_burnout_tool(date_str, user_id=user_id, 
                                                  sleep_time=sleep_time, wake_time=wake_time,
                                                  provided_events=provided_events)
                result_data = json.loads(result_json)
                
                if 'error' in result_data:
                    return jsonify(result_data), 500
                
                return jsonify({
                    "success": True,
                    "date": date_str,
                    "score": result_data.get('score', 50),
                    "status": result_data.get('status', 'building'),
                    "reasoning": result_data.get('reasoning', ''),
                    "key_factors": result_data.get('key_factors', []),
                    "recommendations": result_data.get('recommendations', []),
                    "cached": False
                })
            else:
                # Reload cache after batch calculation
                cache = load_burnout_cache(user_id=user_id)
        
        # Get prediction from cache
        if date_str in cache:
            prediction = cache[date_str]
            print(f"DEBUG: Returning cached prediction for {date_str}: score={prediction.get('score')}, status={prediction.get('status')}", flush=True)
            return jsonify({
                "success": True,
                "date": date_str,
                "score": prediction.get('score', 50),
                "status": prediction.get('status', 'building'),
                "reasoning": prediction.get('reasoning', ''),
                "key_factors": [],  # Not stored in cache
                "recommendations": [],  # Not stored in cache
                "cached": True
            })
        else:
            # Date not in cache and batch calculation didn't include it
            # Fallback to single date prediction
            result_json = predict_burnout_tool(date_str, user_id=user_id, 
                                              sleep_time=sleep_time, wake_time=wake_time,
                                              provided_events=provided_events)
            result_data = json.loads(result_json)
            
            if 'error' in result_data:
                return jsonify(result_data), 500
            
            return jsonify({
                "success": True,
                "date": date_str,
                "score": result_data.get('score', 50),
                "status": result_data.get('status', 'building'),
                "reasoning": result_data.get('reasoning', ''),
                "key_factors": result_data.get('key_factors', []),
                "recommendations": result_data.get('recommendations', []),
                "cached": False
            })

    except json.JSONDecodeError as e:
        return jsonify({
            "error": "Failed to parse burnout prediction result",
            "details": str(e)
        }), 500
    except Exception as e:
        import traceback
        print(f"DEBUG: Exception in predict_burnout: {str(e)}", flush=True)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", flush=True)
        return jsonify({"error": str(e)}), 500


@app.route('/api/burnout/refresh-cache', methods=['POST'])
def refresh_burnout_cache():
    """
    Manually refresh the burnout prediction cache for the next 14 days
    Useful for pre-calculating predictions after calendar sync
    """
    try:
        data = request.json or {}
        user_id = data.get('user_id', 'default_user')
        sleep_time = data.get('sleep_time', '00:00')
        wake_time = data.get('wake_time', '08:00')
        days_ahead = data.get('days_ahead', 14)

        # Validate time formats
        try:
            sleep_hour, sleep_minute = map(int, sleep_time.split(':'))
            if not (0 <= sleep_hour <= 23 and 0 <= sleep_minute <= 59):
                return jsonify({"error": "Invalid sleep_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
            
            wake_hour, wake_minute = map(int, wake_time.split(':'))
            if not (0 <= wake_hour <= 23 and 0 <= wake_minute <= 59):
                return jsonify({"error": "Invalid wake_time format. Use 24-hour format 'HH:MM' (00:00-23:59)"}), 400
        except (ValueError, AttributeError):
            return jsonify({"error": "Invalid time format. Use 24-hour format 'HH:MM' (e.g., '00:00' or '08:00')"}), 400

        # Calculate batch predictions
        result_json = predict_burnout_batch_tool(
            user_id=user_id,
            sleep_time=sleep_time,
            wake_time=wake_time,
            days_ahead=days_ahead
        )
        
        result_data = json.loads(result_json)
        
        if 'error' in result_data:
            return jsonify(result_data), 500
        
        return jsonify({
            "success": True,
            "message": f"Cache refreshed for {days_ahead} days",
            "predictions_count": len(result_data.get('predictions', {}))
        })

    except Exception as e:
        import traceback
        print(f"DEBUG: Exception in refresh_burnout_cache: {str(e)}", flush=True)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", flush=True)
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print("="*80)
    print("Calendar OAuth API Server")
    print("="*80)
    print("Running on: http://localhost:5001")
    print("Frontend should be on: http://localhost:5173")
    print()
    app.run(debug=True, port=5001)