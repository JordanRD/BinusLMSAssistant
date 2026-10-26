import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import uvicorn
import lms_auth
from lms_api import LmsApiClient, html_to_plain_text, is_thread_replied

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_FILE = STATIC_DIR / "index.html"

app = FastAPI(title="BINUS LMS Forum Assistant")

# In-memory client cache
_client: Optional[LmsApiClient] = None
_thread_cache: Dict[str, Dict[str, str]] = {}


def get_client() -> LmsApiClient:
    global _client
    if _client is None:
        auth_pkg = lms_auth.get_authenticated_session(interactive_if_needed=False)
        _client = LmsApiClient(auth_pkg)
    return _client


class PostAnswerRequest(BaseModel):
    thread_id: str
    answer_text: str
    class_id: Optional[str] = None
    session_id: Optional[str] = None


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    if not INDEX_FILE.exists():
        raise HTTPException(status_code=404, detail="Index HTML not found.")
    return INDEX_FILE.read_text(encoding="utf-8")


@app.get("/api/init")
async def api_init():
    try:
        client = get_client()
        user_name = client.user_name
        role_info = client.auth.get("activeRole") or {}
        role = role_info.get("name", "Student")
        acad_career = role_info.get("academicCareer", "OS1")
        institution = role_info.get("institution", "BNS01")

        periods_data = client.get_periods()
        active_period = client.get_active_period(periods_data)

        periods_list = []
        for p in periods_data:
            periods_list.append({
                "code": str(p.get("academicPeriod")),
                "description": p.get("academicPeriodDescription", ""),
                "isRunning": bool(p.get("isRunningPeriod")),
            })

        # Get courses for active period, deduplicated by courseCode (subject)
        raw_courses = client.get_courses(active_period)
        unique_courses = []
        seen = set()
        for c in raw_courses:
            code = c.get("courseCode") or c.get("classId")
            if code not in seen:
                seen.add(code)
                unique_courses.append({
                    "classId": c.get("classId"),
                    "courseCode": c.get("courseCode"),
                    "courseName": c.get("courseName"),
                    "classCode": c.get("classCode"),
                    "lecturers": [l.get("name") for l in c.get("lecturers", [])],
                })

        return {
            "user": {
                "name": user_name,
                "role": role,
                "academicCareer": acad_career,
                "institution": institution,
            },
            "periods": periods_list,
            "activePeriod": active_period,
            "courses": unique_courses,
        }
    except Exception as e:
        return JSONResponse(status_code=401, content={"error": str(e)})


@app.get("/api/subjects")
async def api_subjects(period: str = Query(...)):
    try:
        client = get_client()
        raw_courses = client.get_courses(period)
        unique_courses = []
        seen = set()
        for c in raw_courses:
            code = c.get("courseCode") or c.get("classId")
            if code not in seen:
                seen.add(code)
                unique_courses.append({
                    "classId": c.get("classId"),
                    "courseCode": c.get("courseCode"),
                    "courseName": c.get("courseName"),
                    "classCode": c.get("classCode"),
                    "lecturers": [l.get("name") for l in c.get("lecturers", [])],
                })
        return {"courses": unique_courses}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/sessions")
async def api_sessions(class_id: str = Query(...)):
    try:
        client = get_client()
        raw_sessions = client.get_sessions(class_id)
        if not raw_sessions:
            return {"sessions": [], "activeSessionId": None, "activeSessionNumber": None}

        sessions_meta = []
        active_session_id = None
        active_session_number = None

        for s in raw_sessions:
            num = str(s.get("classSessionNumber", ""))
            sid = s.get("Id") or s.get("id")
            topic = s.get("topicName", "")
            status = s.get("sessionStatus", 0)
            is_active = (status == 3)

            if is_active and not active_session_id:
                active_session_id = sid
                active_session_number = num

            sessions_meta.append({
                "sessionId": sid,
                "classSessionNumber": num,
                "topicName": topic,
                "sessionStatus": status,
                "isActive": is_active,
                "isSessionStarted": bool(s.get("isSessionStarted")),
                "isPostAble": bool(s.get("isPostAble")),
            })

        # Fallback if no sessionStatus == 3: pick latest started session or last session
        if not active_session_id and sessions_meta:
            started = [s for s in sessions_meta if s["isSessionStarted"]]
            target = started[-1] if started else sessions_meta[-1]
            active_session_id = target["sessionId"]
            active_session_number = target["classSessionNumber"]
            target["isActive"] = True

        return {
            "sessions": sessions_meta,
            "activeSessionId": active_session_id,
            "activeSessionNumber": active_session_number,
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/posts")
async def api_posts(
    class_id: str = Query(...),
    session_id: Optional[str] = Query(None),
):
    try:
        client = get_client()
        raw_sessions = client.get_sessions(class_id)
        if not raw_sessions:
            return {"sessions": [], "threads": [], "activeSessionId": None, "selectedSessionId": None}

        sessions_meta = []
        active_session_id = None
        active_session_number = None

        for s in raw_sessions:
            num = str(s.get("classSessionNumber", ""))
            sid = s.get("Id") or s.get("id")
            topic = s.get("topicName", "")
            status = s.get("sessionStatus", 0)
            is_active = (status == 3)

            if is_active and not active_session_id:
                active_session_id = sid
                active_session_number = num

            sessions_meta.append({
                "sessionId": sid,
                "classSessionNumber": num,
                "topicName": topic,
                "sessionStatus": status,
                "isActive": is_active,
                "isSessionStarted": bool(s.get("isSessionStarted")),
                "isPostAble": bool(s.get("isPostAble")),
            })

        if not active_session_id and sessions_meta:
            started = [s for s in sessions_meta if s["isSessionStarted"]]
            target = started[-1] if started else sessions_meta[-1]
            active_session_id = target["sessionId"]
            active_session_number = target["classSessionNumber"]
            target["isActive"] = True

        # Determine single target session (ALL session option removed)
        target_session = None
        target_session_id = session_id or active_session_id

        for s in raw_sessions:
            sid = s.get("Id") or s.get("id")
            num = str(s.get("classSessionNumber", ""))
            if sid == target_session_id or num == target_session_id:
                target_session = s
                break

        if not target_session and raw_sessions:
            for s in raw_sessions:
                sid = s.get("Id") or s.get("id")
                if sid == active_session_id:
                    target_session = s
                    break
            if not target_session:
                target_session = raw_sessions[0]

        if not target_session:
            return {
                "sessions": sessions_meta,
                "activeSessionId": active_session_id,
                "activeSessionNumber": active_session_number,
                "selectedSessionId": None,
                "threads": [],
            }

        sid = target_session.get("Id") or target_session.get("id")
        num = str(target_session.get("classSessionNumber", ""))
        topic = target_session.get("topicName", "")

        # Fetch lecturer threads for only this specific session
        lecturer_threads = client.get_lecturer_threads(class_id, sid)

        def process_thread(t):
            tid = t.get("threadId") or t.get("id")
            try:
                detail = client.get_thread_detail(class_id, tid)
                q_html = detail.get("threadContentText", "")
                author = detail.get("authorFullName") or t.get("authorFullName", "Instructor")
            except Exception:
                detail = {}
                q_html = t.get("threadTitle", "")
                author = t.get("authorFullName", "Instructor")

            # Check reply status by comparing responseDate > threadPostDate (no comment fetching!)
            has_replied, reply_date = is_thread_replied(detail, t)

            return {
                "threadId": tid,
                "sessionId": sid,
                "sessionNumber": num,
                "topicName": topic,
                "title": t.get("threadTitle", "Untitled Thread"),
                "authorName": author,
                "authorRole": t.get("authorRole", "Instructor"),
                "postDate": t.get("postDate", ""),
                "questionText": html_to_plain_text(q_html),
                "hasReplied": has_replied,
                "replyDate": reply_date or "",
            }

        threads_result = []
        if lecturer_threads:
            max_workers = min(4, len(lecturer_threads))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                threads_result = list(executor.map(process_thread, lecturer_threads))

        return {
            "sessions": sessions_meta,
            "activeSessionId": active_session_id,
            "activeSessionNumber": active_session_number,
            "selectedSessionId": target_session_id,
            "threads": threads_result,
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/comments")
async def api_comments(
    class_id: str = Query(...),
    thread_id: str = Query(...),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
):
    try:
        client = get_client()
        result = client.get_thread_comments(class_id, thread_id, page=page, limit=limit)
        return {
            "total": result.get("total", 0),
            "page": page,
            "limit": limit,
            "currentUserId": client.user_id,
            "currentUserName": client.user_name,
            "comments": result.get("datas", []),
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/answer")
async def api_answer(req: PostAnswerRequest):
    if not req.answer_text.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty.")
    try:
        client = get_client()
        cid = req.class_id
        sid = req.session_id
        if (not cid or not sid) and req.thread_id in _thread_cache:
            cached = _thread_cache[req.thread_id]
            cid = cid or cached.get("class_id")
            sid = sid or cached.get("session_id")

        client.post_answer(
            thread_id=req.thread_id,
            answer_text=req.answer_text.strip(),
            class_id=cid,
            session_id=sid,
        )
        return {"success": True, "message": "Answer posted successfully."}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/relogin")
async def api_relogin():
    global _client
    try:
        auth_pkg = lms_auth.trigger_interactive_login()
        _client = LmsApiClient(auth_pkg)
        return {"success": True, "name": auth_pkg.get("name", "User")}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


def start_server(port: int = 8000):
    print("=" * 60)
    print(f"🎓 BINUS LMS Forum Assistant Web Server running at:")
    print(f"👉 http://127.0.0.1:{port}")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    start_server()
