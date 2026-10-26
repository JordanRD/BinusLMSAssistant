import sys
import threading
import time
import webbrowser
import lms_auth


def open_browser_delayed(url: str, delay: float = 1.0):
    time.sleep(delay)
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("--login", "--interactive"):
        print("Starting interactive login...")
        lms_auth.trigger_interactive_login()
        return

    from server import start_server

    port = 8000
    url = f"http://127.0.0.1:{port}"

    # Open browser automatically in background thread
    threading.Thread(target=open_browser_delayed, args=(url,), daemon=True).start()

    # Start FastAPI server
    start_server(port=port)


if __name__ == "__main__":
    main()
