"""
Quick script to test API key and list available models
"""
import os
from google import genai

# Support both GEMINI_API_KEY (legacy) and GOOGLE_API_KEY
api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY', 'gen-lang-client-0058781768')

print(f"Testing API key: {api_key[:20]}...")

# Set GOOGLE_API_KEY for genai.Client() to pick up automatically
if not os.getenv('GOOGLE_API_KEY'):
    os.environ['GOOGLE_API_KEY'] = api_key

try:
    client = genai.Client()

    # Try listing models
    print("\nAttempting to list models...")
    models = client.models.list()

    print("\nAvailable models:")
    for model in models:
        print(f"  - {model.name}")

except Exception as e:
    print(f"\nError: {e}")
    print("\nTrying a simple generation request with gemini-1.5-flash...")

    try:
        client = genai.Client()
        response = client.models.generate_content(
            model='gemini-1.5-flash',
            contents='Say hello'
        )
        print(f"Success! Response: {response.text}")
    except Exception as e2:
        print(f"Also failed: {e2}")