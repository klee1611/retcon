"""One command for the live demo: start the dashboard, open it, then step through the demo.

    uv run python scripts/live_demo.py            # presenter mode (press Enter between acts)
    uv run python scripts/live_demo.py --no-pause # run straight through

If a dashboard is already running on port 8000 it is reused; otherwise one is started
here and stopped when the demo ends.
"""

import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "http://localhost:8000/"


def dashboard_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "state", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def main() -> None:
    pause = "--no-pause" not in sys.argv
    server = None
    if dashboard_up():
        print(f"Dashboard already running at {URL}")
    else:
        print("Starting the dashboard...")
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "dashboard.app:app", "--port", "8000",
             "--log-level", "warning", "--timeout-graceful-shutdown", "2"],
            cwd=ROOT)
        for _ in range(60):
            if dashboard_up():
                break
            if server.poll() is not None:
                sys.exit("The dashboard failed to start (is port 8000 in use by something else?)")
            time.sleep(0.5)
        else:
            server.terminate()
            sys.exit("The dashboard did not respond within 30 seconds.")
        print(f"Dashboard running at {URL}")

    if "--no-browser" not in sys.argv:
        webbrowser.open(URL)
    print("\nPut the browser and this terminal side by side, and press 'Clear timeline' in the dashboard.")
    if pause:
        print("Press Enter at each prompt to move to the next act.\n")

    try:
        args = [sys.executable, "-u", str(ROOT / "scripts" / "demo.py")] + (["--pause"] if pause else [])
        subprocess.run(args, cwd=ROOT, check=False)
    finally:
        if server:
            if pause:  # keep the dashboard up for questions until the presenter is done
                try:
                    input("\nDemo finished. Press Enter to stop the dashboard. ")
                except (EOFError, KeyboardInterrupt):
                    pass
            server.terminate()  # open browser tabs keep a live event stream; don't wait on them forever
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
            print("Dashboard stopped.")


if __name__ == "__main__":
    main()
