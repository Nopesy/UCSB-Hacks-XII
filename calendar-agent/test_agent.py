"""
Test Script for Calendar Agent
Quick tests to verify everything works
"""

from calendar_agent import run_query
from calendar_tools import CalendarTools


def test_direct_calendar_access():
    """
    Test 1: Direct calendar access (without agent)
    """
    print("="*80)
    print("TEST 1: Direct Calendar Access")
    print("="*80)

    try:
        cal = CalendarTools()
        print("✅ Successfully loaded credentials")

        # Get events
        events = cal.get_events(days_ahead=7)
        print(f"✅ Found {len(events)} upcoming events")

        if events:
            print("\nUpcoming events:")
            for event in events[:3]:
                print(f"  - {event['title']}: {event['start']}")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_agent_read_calendar():
    """
    Test 2: Agent reads calendar
    """
    print("\n" + "="*80)
    print("TEST 2: Agent Reading Calendar")
    print("="*80)

    try:
        query = "What's on my calendar this week?"
        print(f"\nQuery: {query}")
        print("\nAgent response:")
        response = run_query(query)
        print(response)
        print("\n✅ Agent successfully read calendar")
        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_agent_create_event():
    """
    Test 3: Agent creates an event
    """
    print("\n" + "="*80)
    print("TEST 3: Agent Creating Event")
    print("="*80)

    try:
        query = "Schedule a 30 minute meeting called 'Agent Test' tomorrow at 2pm"
        print(f"\nQuery: {query}")
        print("\n⚠️  This will CREATE a real calendar event!")
        response = input("Continue? (y/n): ").strip().lower()

        if response != 'y':
            print("Skipped")
            return True

        print("\nAgent response:")
        response = run_query(query)
        print(response)
        print("\n✅ Check your Google Calendar to verify the event was created!")
        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_agent_find_free_time():
    """
    Test 4: Agent finds free time
    """
    print("\n" + "="*80)
    print("TEST 4: Agent Finding Free Time")
    print("="*80)

    try:
        query = "When am I free tomorrow for a 30 minute meeting?"
        print(f"\nQuery: {query}")
        print("\nAgent response:")
        response = run_query(query)
        print(response)
        print("\n✅ Agent successfully found free time")
        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def run_all_tests():
    """
    Run all tests
    """
    print("\n" + "="*80)
    print("CALENDAR AGENT MVP TEST SUITE")
    print("="*80)
    print("\nThis will test:")
    print("1. Direct calendar access")
    print("2. Agent reading calendar")
    print("3. Agent creating events (optional)")
    print("4. Agent finding free time")
    print()

    results = []

    # Test 1
    results.append(("Direct Calendar Access", test_direct_calendar_access()))

    # Test 2
    if results[0][1]:  # Only if test 1 passed
        results.append(("Agent Read Calendar", test_agent_read_calendar()))

    # Test 3
    if len(results) > 0 and results[-1][1]:
        results.append(("Agent Create Event", test_agent_create_event()))

    # Test 4
    if len(results) > 0 and results[-1][1]:
        results.append(("Agent Find Free Time", test_agent_find_free_time()))

    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)

    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")

    total = len(results)
    passed = sum(1 for _, p in results if p)

    print(f"\nPassed: {passed}/{total}")

    if passed == total:
        print("\n🎉 All tests passed! MVP is working!")
        print("\nYou can now:")
        print("  - Run: python calendar_agent.py (interactive mode)")
        print("  - Use: from calendar_agent import run_query")
        print("  - Build your web interface on top of this")


if __name__ == "__main__":
    run_all_tests()
