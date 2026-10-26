import sys
import time
from browser import create_driver, get_browser, DEFAULT_USER_DATA_DIR
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def demo_with_context_manager():
    """Example using the context manager (auto-closes driver on exit)."""
    print("Launching Chrome with stored user profile...")
    print(f"User data directory: {DEFAULT_USER_DATA_DIR}")

    with get_browser() as driver:
        # Example: Open a test site or LMS
        driver.get("https://duckduckgo.com")
        print(f"Page title: {driver.title}")

        # Wait for search box to be present
        search_box = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.NAME, "q"))
        )
        search_box.send_keys("Selenium automation with uv")
        time.sleep(2)
        print("Demo completed successfully!")


def interactive_session():
    """Keep browser open for manual login and verify session persistence."""
    print("=" * 60)
    print("Interactive Session with Stored User Data")
    print(f"Profile location: {DEFAULT_USER_DATA_DIR}")
    print("Any login or cookies saved in this session will persist across runs.")
    print("=" * 60)

    driver = create_driver()
    try:
        driver.get("https://www.google.com")
        print("\nBrowser is open. You can:")
        print("1. Log in to your target website (e.g., LMS/Moodle/Canvas).")
        print("2. Check 'Remember Me' or stay signed in.")
        print("3. Press ENTER in this terminal when finished to close.\n")
        input("Press [Enter] to close browser: ")
    finally:
        driver.quit()
        print("Browser closed. Profile data has been saved.")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--interactive":
        interactive_session()
    else:
        demo_with_context_manager()


if __name__ == "__main__":
    main()
