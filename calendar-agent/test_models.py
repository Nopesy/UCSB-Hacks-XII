"""
Quick script to test API key and list available models
"""
import os
from google import genai

api_key = os.getenv('GEMINI_API_KEY', 'gen-lang-client-0058781768')

print(f"Testing API key: {api_key[:20]}...")

try:
    client = genai.Client(api_key=api_key)

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
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model='gemini-1.5-flash',
            contents='Say hello'
        )
        print(f"Success! Response: {response.text}")
    except Exception as e2:
        print(f"Also failed: {e2}")