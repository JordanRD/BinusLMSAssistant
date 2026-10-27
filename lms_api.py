import html
import json
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import requests

APIM_BASE = "https://apim-bm7-prod-web.azure-api.net"
COURSE_SERVICE = f"{APIM_BASE}/func-bm7-course-prod"
FORUM_SERVICE = f"{APIM_BASE}/func-bm7-forum-prod"
ASSESSMENT_SERVICE = "https://apim-bm7-assessment-prod.azure-api.net/func-bm7-assessment-prod"



def parse_iso_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO datetime string, normalizing timezones to naive UTC."""
    if not dt_str:
        return None
    try:
        clean_str = dt_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean_str)
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt
    except Exception:
        return None


def is_thread_replied(detail: Dict[str, Any], summary: Optional[Dict[str, Any]] = None) -> Tuple[bool, Optional[str]]:
    """Determine whether the thread has been replied by comparing responseDate > threadPostDate.
    Returns (has_replied, response_date_str).
    """
    summary = summary or {}
    resp_date_str = detail.get("responseDate") or summary.get("responseDate")
    post_date_str = detail.get("threadPostDate") or detail.get("postDate") or summary.get("postDate")

    if not resp_date_str:
        return False, None

    resp_dt = parse_iso_datetime(resp_date_str)
    post_dt = parse_iso_datetime(post_date_str)

    if resp_dt and post_dt:
        return (resp_dt > post_dt), resp_date_str
    elif resp_dt:
        return True, resp_date_str

    return (resp_date_str > (post_date_str or "")), resp_date_str


def html_to_plain_text(html_content: str) -> str:
    """Convert HTML string to clean, formatted readable text."""
    if not html_content:
        return ""
    text = html.unescape(html_content)
    # Replace breaks and paragraphs with newlines
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</li>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li>", "• ", text, flags=re.IGNORECASE)
    # Strip remaining tags
    text = re.sub(r"<[^>]+>", "", text)
    # Clean redundant spaces & newlines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def text_to_html(plain_text: str) -> str:
    """Wrap plain text lines into clean HTML <p> tags for LMS."""
    if not plain_text:
        return ""
    # If user already wrote HTML, don't double wrap
    if plain_text.strip().startswith("<") and plain_text.strip().endswith(">"):
        return plain_text.strip()
    
    paragraphs = [p.strip() for p in plain_text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [plain_text.strip()]
    
    html_parts = []
    for p in paragraphs:
        escaped = html.escape(p).replace("\n", "<br/>")
        html_parts.append(f"<p>{escaped}</p>")
    return "".join(html_parts)


class LmsApiClient:
    """Client for interacting with Binusmaya LMS microservices via APIM."""

    def __init__(self, auth_package: Dict[str, Any]):
        self.auth = auth_package
        self.user_id = auth_package.get("user_id", "")
        self.user_name = auth_package.get("name", "")
        self.headers = auth_package.get("headers", {}).copy()
        
        self.session = requests.Session()
        self.session.headers.update(self.headers)
        self._cache: Dict[str, Tuple[float, Any]] = {}

    def _get_cache(self, key: str, ttl_seconds: float) -> Optional[Any]:
        if key in self._cache:
            ts, val = self._cache[key]
            if time.time() - ts < ttl_seconds:
                return val
        return None

    def _set_cache(self, key: str, val: Any) -> None:
        self._cache[key] = (time.time(), val)

    def get_periods(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch all academic periods available to the student (cached 1 hour)."""
        cache_key = "periods"
        if not force_refresh:
            cached = self._get_cache(cache_key, 3600)
            if cached is not None:
                return cached

        url = f"{COURSE_SERVICE}/AcademicPeriod/Student"
        resp = self.session.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        self._set_cache(cache_key, data)
        return data

    def get_active_period(self, periods: Optional[List[Dict[str, Any]]] = None) -> str:
        """Find the active/running period code (e.g. '2611')."""
        if periods is None:
            periods = self.get_periods()
        
        # 1. Match isRunningPeriod == True and status == True
        for p in periods:
            if p.get("academicPeriodStatus") and p.get("isRunningPeriod"):
                return str(p["academicPeriod"])
        
        # 2. Match any academicPeriodStatus == True
        for p in periods:
            if p.get("academicPeriodStatus"):
                return str(p["academicPeriod"])
        
        return str(periods[0]["academicPeriod"]) if periods else "2611"

    def get_courses(self, period: str, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch enrolled courses (LEC component only) for a period (cached 30 mins)."""
        return self.get_courses_by_component(period, "LEC", force_refresh=force_refresh)

    def get_courses_by_component(self, period: str, component: str = "LEC", force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch enrolled courses for a given component (e.g. 'LEC' or 'LAB') in a period (cached 30 mins)."""
        component = component.upper()
        cache_key = f"courses_{period}_{component}"
        if not force_refresh:
            cached = self._get_cache(cache_key, 1800)
            if cached is not None:
                return cached

        url = f"{COURSE_SERVICE}/Course/Period/{period}/Component/{component}/Student"
        try:
            resp = self.session.get(url, timeout=15)
            if resp.status_code == 200:
                courses = resp.json()
                if isinstance(courses, list):
                    for c in courses:
                        c["component"] = component
                    self._set_cache(cache_key, courses)
                    return courses
        except Exception as e:
            print(f"[lms_api] Warning fetching {component} courses for period {period}: {e}")

        return []

    def get_courses_all_components(self, period: str, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch courses across both LEC and LAB components for a period."""
        all_courses = []
        for comp in ["LEC", "LAB"]:
            comp_courses = self.get_courses_by_component(period, comp, force_refresh=force_refresh)
            all_courses.extend(comp_courses)
        return all_courses

    def get_assessment_cards(self, class_id: str, academic_period: str, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch assessment cards for a class and period (cached 10 mins)."""
        cache_key = f"assessments_{class_id}_{academic_period}"
        if not force_refresh:
            cached = self._get_cache(cache_key, 600)
            if cached is not None:
                return cached

        url = f"{ASSESSMENT_SERVICE}/Assessment/Class/{class_id}/Cards?academicPeriod={academic_period}"
        payload = {
            "continuationToken": None,
            "orderBy": "asc",
            "sortBy": "title",
            "status": [],
            "feedbacks": [],
            "availabilities": [],
            "sessionNumbers": [],
            "subjects": [],
            "types": []
        }
        try:
            resp = self.session.post(url, json=payload, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                groups = data.get("data", []) if isinstance(data, dict) else []
                self._set_cache(cache_key, groups)
                return groups
            else:
                print(f"[lms_api] Assessment Cards HTTP {resp.status_code} for class {class_id}")
        except Exception as e:
            print(f"[lms_api] Error fetching assessment cards for class {class_id}: {e}")

        return []

    def get_sessions(self, class_id: str, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Fetch forum sessions for a class (cached 5 mins)."""
        cache_key = f"sessions_{class_id}"
        if not force_refresh:
            cached = self._get_cache(cache_key, 300)
            if cached is not None:
                return cached

        url = f"{COURSE_SERVICE}/Forum/Class/{class_id}/Student"
        resp = self.session.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        sessions = data.get("sessions", [])
        self._set_cache(cache_key, sessions)
        return sessions

    def get_active_sessions(self, class_id: str) -> List[Dict[str, Any]]:
        """Filter sessions that are currently active (status == 3 or postable)."""
        all_sessions = self.get_sessions(class_id)
        active = []
        for s in all_sessions:
            status = s.get("sessionStatus", 0)
            is_postable = s.get("isPostAble", False)
            if status == 3 or is_postable:
                active.append(s)
        # If no status == 3 found, return all postable or latest sessions
        if not active and all_sessions:
            active = all_sessions[-3:]
        return active

    def get_threads(self, class_id: str, session_id: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Fetch thread list for a class and session."""
        url = f"{FORUM_SERVICE}/Thread/Class/{class_id}/Session/{session_id}/Paging/1"
        payload = {"TotalDataPerPage": limit}
        resp = self.session.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else data.get("datas", [])

    def get_lecturer_threads(self, class_id: str, session_id: str) -> List[Dict[str, Any]]:
        """Fetch threads specifically created by instructors/lecturers."""
        threads = self.get_threads(class_id, session_id)
        lecturer_threads = [t for t in threads if t.get("authorRole") in ("Instructor", "Primary Instructor", "Secondary Instructor")]
        # Fallback: if role isn't explicitly Instructor, return threads with totalComment > 0 or Discussion type
        if not lecturer_threads and threads:
            lecturer_threads = threads
        return lecturer_threads

    def get_thread_detail(self, class_id: str, thread_id: str, force_refresh: bool = False) -> Dict[str, Any]:
        """Fetch full thread question details (cached 10 mins)."""
        cache_key = f"detail_{class_id}_{thread_id}"
        if not force_refresh:
            cached = self._get_cache(cache_key, 600)
            if cached is not None:
                return cached

        url = f"{FORUM_SERVICE}/Forum/{class_id}/Thread/{thread_id}?originMultiClassId=null"
        resp = self.session.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        self._set_cache(cache_key, data)
        return data

    def get_thread_comments(
        self, class_id: str, thread_id: str, page: int = 1, limit: int = 25
    ) -> Dict[str, Any]:
        """Fetch student and lecturer replies on a thread with pagination support."""
        url = f"{FORUM_SERVICE}/Comment/PagingV20221122/{page}"
        payload = {
            "forumId": class_id,
            "totalDataPerPage": limit,
            "parentId": thread_id,
            "sortBy": "LatestPost",
            "highlightCommentId": "",
            "highlightReplyId": "",
            "threadId": thread_id,
            "isMultiClassDiscussion": False,
            "multiClassIds": [],
            "originMultiClassId": None,
        }
        resp = self.session.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict):
            return {
                "total": data.get("totalData", 0),
                "page": page,
                "datas": data.get("datas", []),
            }
        return {
            "total": len(data) if isinstance(data, list) else 0,
            "page": page,
            "datas": data if isinstance(data, list) else [],
        }

    def check_user_replied(self, class_id: str, thread_id: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """Check if current user has replied to thread. Returns (has_replied, comment_text, comment_date)."""
        res = self.get_thread_comments(class_id, thread_id, page=1, limit=50)
        comments = res.get("datas", []) if isinstance(res, dict) else res
        for c in comments:
            if c.get("authorId") == self.user_id:
                return True, c.get("commentText", ""), c.get("postDate", "")
        return False, None, None

    def find_thread_meta(self, thread_id: str) -> Tuple[Optional[str], Optional[str]]:
        """Attempt to resolve (class_id, session_id) for a given thread_id across active courses."""
        try:
            periods = self.get_periods()
            active_p = self.get_active_period(periods)
            courses = self.get_courses(active_p)
            for c in courses:
                cid = c.get("classId")
                if not cid:
                    continue
                try:
                    detail = self.get_thread_detail(cid, thread_id)
                    sid = None
                    for tag in detail.get("tags", []):
                        if tag.get("name") == "Session" and tag.get("id"):
                            sid = tag.get("id")
                            break
                    if not sid:
                        s_num = str(detail.get("sessionNumber", ""))
                        sessions = self.get_sessions(cid)
                        for s in sessions:
                            if str(s.get("classSessionNumber", "")) == s_num:
                                sid = s.get("Id") or s.get("id")
                                break
                    return cid, sid
                except Exception:
                    continue
        except Exception as e:
            print(f"[lms_api] Error finding thread meta: {e}")
        return None, None

    def post_answer(
        self,
        thread_id: str,
        answer_text: str,
        class_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Post a response comment to a forum thread using multipart/form-data."""
        url = f"{FORUM_SERVICE}/Comment/Post"
        html_answer = text_to_html(answer_text)

        if not class_id or not session_id:
            resolved_class_id, resolved_session_id = self.find_thread_meta(thread_id)
            class_id = class_id or resolved_class_id
            session_id = session_id or resolved_session_id

        payload_dict = {
            "parentId": thread_id,
            "quoteId": "",
            "quoteText": "",
            "commentType": "Comment",
            "commentText": html_answer,
            "forumId": class_id or "",
            "classSessionId": session_id or "",
            "threadId": thread_id,
            "isMultiClassDiscussion": False,
            "multiClassIds": [],
            "originMultiClassId": None,
        }

        # Copy headers and remove Content-Type so requests sets multipart boundary automatically
        headers = self.headers.copy()
        headers.pop("Content-Type", None)

        # Multipart form data with json field
        data = {"json": json.dumps(payload_dict)}
        files = {"file": ("", b"", "application/octet-stream")}

        resp = requests.post(url, headers=headers, data=data, files=files, timeout=20)
        if resp.status_code >= 400:
            error_msg = resp.text.strip() or f"HTTP {resp.status_code}"
            raise RuntimeError(f"LMS API Error ({resp.status_code}): {error_msg}")
        return resp.json()
