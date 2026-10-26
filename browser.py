import os
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Optional

from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

# Load environment configuration
load_dotenv()

DEFAULT_USER_DATA_DIR = Path(__file__).resolve().parent / ".chrome_user_data"


def get_chrome_options(
    user_data_dir: Optional[str | Path] = None,
    profile_dir: Optional[str] = None,
    headless: Optional[bool] = None,
) -> Options:
    """Configure Chrome options with persistent user data and anti-bot mitigation.

    Args:
        user_data_dir: Directory where Chrome stores cookies, cache, and session
          data.
        profile_dir: Profile folder name (default: "Default").
        headless: Whether to run headless (default read from env HEADLESS or
          False).
    """
    options = Options()

    # Resolve user data directory as an absolute path
    if user_data_dir is None:
        env_dir = os.getenv("CHROME_USER_DATA_DIR")
        user_data_dir = (
            Path(env_dir).resolve() if env_dir else DEFAULT_USER_DATA_DIR
        )
    else:
        user_data_dir = Path(user_data_dir).resolve()

    user_data_dir.mkdir(parents=True, exist_ok=True)
    options.add_argument(f"--user-data-dir={str(user_data_dir)}")

    # Profile directory inside user data dir
    if profile_dir is None:
        profile_dir = os.getenv("CHROME_PROFILE_DIR", "Default")
    options.add_argument(f"--profile-directory={profile_dir}")

    # Headless configuration
    if headless is None:
        headless = os.getenv("HEADLESS", "false").lower() in ("true", "1", "yes")
    if headless:
        options.add_argument("--headless=new")

    # Anti-bot detection mitigation & UI stabilization
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_experimental_option(
        "excludeSwitches", ["enable-automation", "enable-logging"]
    )
    options.add_experimental_option("useAutomationExtension", False)

    return options


def create_driver(
    user_data_dir: Optional[str | Path] = None,
    profile_dir: Optional[str] = None,
    headless: Optional[bool] = None,
) -> webdriver.Chrome:
    """Initialize and return a Chrome WebDriver instance with stored user data."""
    options = get_chrome_options(
        user_data_dir=user_data_dir,
        profile_dir=profile_dir,
        headless=headless,
    )
    service = Service()
    driver = webdriver.Chrome(service=service, options=options)

    # Remove navigator.webdriver flag via CDP script
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {
            "source": """
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            """
        },
    )

    return driver


@contextmanager
def get_browser(
    user_data_dir: Optional[str | Path] = None,
    profile_dir: Optional[str] = None,
    headless: Optional[bool] = None,
) -> Generator[webdriver.Chrome, None, None]:
    """Context manager to ensure proper cleanup of the browser driver.

    Usage:
        with get_browser() as driver:
            driver.get("https://example.com")
    """
    driver = create_driver(
        user_data_dir=user_data_dir,
        profile_dir=profile_dir,
        headless=headless,
    )
    try:
        yield driver
    finally:
        driver.quit()
