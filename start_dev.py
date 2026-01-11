#!/usr/bin/env python3
"""
Development Server Startup Script
Runs: Node.js backend (port 3000), Flask API (port 5001), Vite frontend (port 5173)
Handles graceful shutdown on Ctrl+C and detects already-running servers
"""

import subprocess
import signal
import sys
import time
import socket
import os
from pathlib import Path

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
NC = '\033[0m'  # No Color

# Project directories
SCRIPT_DIR = Path(__file__).parent.resolve()
BACKEND_DIR = SCRIPT_DIR
FLASK_DIR = SCRIPT_DIR / 'calendar-agent'
FRONTEND_DIR = SCRIPT_DIR / 'UCSB-Hacks-XII-FrontEnd'

# Server configurations
SERVERS = [
    {
        'name': 'Node.js Backend',
        'port': 3000,
        'command': ['node', 'server.js'],
        'cwd': BACKEND_DIR,
        'env': {'PORT': '3000'},
    },
    {
        'name': 'Flask API',
        'port': 5001,
        'command': ['python', 'api_server.py'],
        'cwd': FLASK_DIR,
    },
    {
        'name': 'Vite Frontend',
        'port': 5173,
        'command': ['npm', 'run', 'dev'],
        'cwd': FRONTEND_DIR,
        'timeout': 60,  # Vite can be slow to start
    },
]

# Track processes we started
started_processes: list[subprocess.Popen] = []


def check_port(port: int) -> bool:
    """Check if a port is in use by trying to connect to it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == 0


def kill_port(port: int) -> bool:
    """Kill any process using the given port. Returns True if something was killed."""
    try:
        result = subprocess.run(
            ['lsof', '-t', '-i', f':{port}'],
            capture_output=True,
            text=True,
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                try:
                    os.kill(int(pid), signal.SIGTERM)
                except (ProcessLookupError, ValueError):
                    pass
            time.sleep(1)  # Give processes time to terminate
            return True
    except Exception:
        pass
    return False


def wait_for_port(port: int, name: str, timeout: int = 30) -> bool:
    """Wait for a port to become available."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if check_port(port):
            return True
        time.sleep(0.5)
    return False


def cleanup(signum=None, frame=None):
    """Gracefully shutdown all servers we started."""
    print(f"\n{YELLOW}Shutting down servers...{NC}")

    # Shutdown in reverse order (frontend first, then APIs)
    for proc in reversed(started_processes):
        if proc.poll() is None:  # Process is still running
            print(f"{YELLOW}Stopping process (PID: {proc.pid})...{NC}")
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print(f"{RED}Force killing process (PID: {proc.pid})...{NC}")
                proc.kill()
                proc.wait()

    print(f"{GREEN}All servers stopped gracefully.{NC}")
    sys.exit(0)


def main():
    # Set up signal handlers for graceful shutdown
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    # Check for --force flag
    force_restart = '--force' in sys.argv or '-f' in sys.argv

    print(f"{BLUE}========================================{NC}")
    print(f"{BLUE}   Burnout Radar Development Servers   {NC}")
    print(f"{BLUE}========================================{NC}")
    if force_restart:
        print(f"{YELLOW}   (Force restart mode){NC}")
    print()

    all_running = True

    # Check and start each server
    for i, server in enumerate(SERVERS, 1):
        name = server['name']
        port = server['port']
        command = server['command']
        cwd = server['cwd']

        print(f"{BLUE}[{i}/{len(SERVERS)}] {name} (port {port}){NC}")

        if check_port(port):
            if force_restart:
                print(f"{YELLOW}  Killing existing process on port {port}...{NC}")
                kill_port(port)
                time.sleep(0.5)
            else:
                print(f"{GREEN}  Already running{NC}")
                continue

        all_running = False
        print(f"{YELLOW}  Starting {name}...{NC}")

        try:
            # Merge any server-specific env vars with current environment
            proc_env = os.environ.copy()
            if server.get('env'):
                proc_env.update(server['env'])

            # Start the process
            # Show output for Vite and Flask since they provide helpful info
            show_output = name in ['Vite Frontend', 'Flask API']
            stdout_dest = None if show_output else subprocess.DEVNULL
            stderr_dest = None if show_output else subprocess.DEVNULL

            proc = subprocess.Popen(
                command,
                cwd=cwd,
                env=proc_env,
                stdout=stdout_dest,
                stderr=stderr_dest,
                # Create new process group on Unix for cleaner shutdown
                preexec_fn=os.setsid if hasattr(os, 'setsid') else None,
            )
            started_processes.append(proc)

            # Wait for the server to be ready
            timeout = server.get('timeout', 45)
            if wait_for_port(port, name, timeout=timeout):
                print(f"{GREEN}  {name} started (PID: {proc.pid}){NC}")
            else:
                # For Vite, just warn - it might be running on a different port
                if name == 'Vite Frontend':
                    print(f"{YELLOW}  {name} may be slow to start (PID: {proc.pid}){NC}")
                    print(f"{YELLOW}  Check if it's running at http://localhost:5173 or nearby port{NC}")
                else:
                    print(f"{RED}  Failed to start {name} - timeout waiting for port {port}{NC}")
                    cleanup()

        except FileNotFoundError as e:
            print(f"{RED}  Failed to start {name}: {e}{NC}")
            cleanup()
        except Exception as e:
            print(f"{RED}  Error starting {name}: {e}{NC}")
            cleanup()

    print()
    print(f"{GREEN}========================================{NC}")
    print(f"{GREEN}   All servers are running!            {NC}")
    print(f"{GREEN}========================================{NC}")
    print()
    print(f"  Frontend:     {BLUE}http://localhost:5173{NC}")
    print(f"  Node Backend: {BLUE}http://localhost:3000{NC}")
    print(f"  Flask API:    {BLUE}http://localhost:5001{NC}")
    print()

    # If all servers were already running, just exit
    if all_running and len(started_processes) == 0:
        print(f"{GREEN}All servers were already running. Nothing to manage.{NC}")
        sys.exit(0)

    print(f"{YELLOW}Press Ctrl+C to stop servers started by this script{NC}")
    print()

    # Monitor processes and keep running
    try:
        while True:
            # Only monitor processes we started
            if len(started_processes) == 0:
                time.sleep(2)
                continue

            for proc in started_processes:
                if proc.poll() is not None:
                    # Process has died
                    print(f"{RED}A server died unexpectedly (PID: {proc.pid}, exit code: {proc.returncode}){NC}")
                    cleanup()
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()


if __name__ == '__main__':
    main()
