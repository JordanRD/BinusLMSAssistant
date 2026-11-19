import json
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import uvicorn
import lms_auth
from lms_api import LmsApiClient, html_to_plain_text, is_thread_replied
from mcp_server import mcp as mcp_instance, mcp_app

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

STATIC_DIR = Path(__file__).resolve().parent / "static"
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp_instance.session_manager.run():
        yield


app = FastAPI(title="BINUS LMS Forum Assistant", lifespan=lifespan)

# Rewrite /mcp to /mcp/ so both /mcp and /mcp/ work seamlessly without redirect issues
@app.middleware("http")
async def rewrite_mcp_path(request: Request, call_next):
    if request.url.path == "/mcp":
        request.scope["path"] = "/mcp/"
    return await call_next(request)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/mcp", mcp_app)
templates = Jinja2Templates(directory=TEMPLATES_DIR)

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


@app.get("/")
async def root():
    return RedirectResponse(url="/forum")


@app.get("/forum", response_class=HTMLResponse)
async def serve_forum(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="forum.html",
        context={
            "active_page": "forum",
            "page_title": "Forum Diskusi",
            "page_subtitle": "Kelola dan jawab pertanyaan dosen BINUS LMS",
        },
    )


@app.get("/schedule", response_class=HTMLResponse)
async def serve_schedule(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="schedule.html",
        context={
            "active_page": "schedule",
            "page_title": "Jadwal Kuliah & Asesmen",
            "page_subtitle": "Jadwal perkuliahan dan sesi kelas",
        },
    )


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
async def api_subjects(
    period: str = Query(...),
    include_lab: bool = Query(False),
):
    try:
        client = get_client()
        raw_courses = (
            client.get_courses_all_components(period)
            if include_lab
            else client.get_courses(period)
        )
        unique_courses = []
        seen = set()
        for c in raw_courses:
            code = (
                f"{c.get('classId')}_{c.get('component', 'LEC')}"
                if include_lab
                else (c.get("courseCode") or c.get("classId"))
            )
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


@app.get("/api/schedule/assessments")
async def api_schedule_assessments(
    period: Optional[str] = Query(None),
    force_refresh: bool = Query(False)
):
    try:
        client = get_client()
        active_period = period or client.get_active_period()
        courses = client.get_courses_all_components(active_period, force_refresh=force_refresh)

        def fetch_cards_for_course(c: Dict[str, Any]) -> List[Dict[str, Any]]:
            cid = c.get("classId")
            if not cid:
                return []
            groups = client.get_assessment_cards(cid, active_period, force_refresh=force_refresh)
            cards = []
            for g in groups:
                activity_name = g.get("assessmentActivity", "")
                lam_weight = g.get("lamWeight", "")
                group_lam_type = g.get("lamType", "")
                for it in g.get("data", []):
                    title = it.get("assesmentTitle") or it.get("title") or activity_name
                    csc_id = it.get("classSessionContentId")
                    cs_id = it.get("classSessionId")
                    if csc_id and cs_id:
                        deep_link = f"https://lms.binus.ac.id/lms/course/assessment-student/classId/{cid}/resourceId/{csc_id}/sessionId/{cs_id}/online"
                    else:
                        deep_link = f"https://lms.binus.ac.id/lms/course/{cid}"

                    cards.append({
                        "id": f"{cid}_{it.get('assessmentId', '')}_{it.get('sessionNumber', '')}_{it.get('dateStart', '')}",
                        "assessmentId": it.get("assessmentId"),
                        "assessmentGroupId": (
                            it.get("assessmentGroupId")
                            or it.get("assesmentGroupId")
                            or it.get("groupId")
                            or it.get("assessmentGroupID")
                            or it.get("assesmentGroupID")
                            or g.get("assessmentGroupId")
                            or g.get("assesmentGroupId")
                            or g.get("groupId")
                        ),
                        "classId": cid,
                        "courseCode": c.get("courseCode"),
                        "courseName": c.get("courseName"),
                        "classCode": c.get("classCode"),
                        "component": c.get("component", "LEC"),
                        "title": title,
                        "activityName": activity_name,
                        "lamType": it.get("lamType") or group_lam_type or "OTH",
                        "lamWeight": lam_weight,
                        "sessionNumber": it.get("sessionNumber"),
                        "classSessionId": cs_id,
                        "classSessionContentId": csc_id,
                        "dateStart": it.get("dateStart"),
                        "dueDate": it.get("dueDate"),
                        "status": it.get("status"),
                        "totalAttempted": it.get("totalAttempted", 0),
                        "scorePts": it.get("scorePts"),
                        "isScored": it.get("isScored", False),
                        "isRestricted": it.get("isRestricted", False),
                        "submissionDate": it.get("firstAttemptSubmittedDate"),
                        "deepLink": deep_link,
                    })
            return cards

        with ThreadPoolExecutor(max_workers=6) as executor:
            card_batches = list(executor.map(fetch_cards_for_course, courses))

        flattened = [card for batch in card_batches for card in batch]
        # Sort by dueDate ascending, null dates at the end
        flattened.sort(key=lambda x: x.get("dueDate") or "9999-12-31T23:59:59")

        subjects = []
        seen_subj = set()
        for c in courses:
            key = f"{c.get('classId')}_{c.get('component')}"
            if key not in seen_subj:
                seen_subj.add(key)
                subjects.append({
                    "classId": c.get("classId"),
                    "courseCode": c.get("courseCode"),
                    "courseName": c.get("courseName"),
                    "classCode": c.get("classCode"),
                    "component": c.get("component"),
                })

        return {
            "period": active_period,
            "subjects": subjects,
            "assessments": flattened,
            "total": len(flattened),
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


def _find_matching_group(
    group_sets: List[Dict[str, Any]],
    assessment_group_id: Optional[str],
    user_id: str,
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Find the (group_set, group) matching assessment_group_id, or fallback to user's group."""
    def contains_user(grp: Dict[str, Any]) -> bool:
        return any(p.get("userId") == user_id for p in (grp.get("people") or []))

    if assessment_group_id:
        # 1. Exact match on individual group.id
        for gs in group_sets:
            for grp in gs.get("groupList") or []:
                if grp.get("id") == assessment_group_id:
                    return gs, grp

        # 2. Match on groupSet.id (pick group containing user, or first group)
        for gs in group_sets:
            if gs.get("id") == assessment_group_id:
                glist = gs.get("groupList") or []
                for grp in glist:
                    if contains_user(grp):
                        return gs, grp
                if glist:
                    return gs, glist[0]

    # 3. Fallback: find group containing the current user
    if user_id:
        for gs in group_sets:
            for grp in gs.get("groupList") or []:
                if contains_user(grp):
                    return gs, grp

    # 4. Last resort: first available group
    for gs in group_sets:
        glist = gs.get("groupList") or []
        if glist:
            return gs, glist[0]

    return None, None


@app.get("/api/schedule/team")
async def api_schedule_team(
    class_id: str = Query(...),
    assessment_group_id: Optional[str] = Query(None),
    force_refresh: bool = Query(False),
):
    try:
        client = get_client()
        group_sets = client.get_class_groups(class_id, force_refresh=force_refresh)
        matched_set, matched_group = _find_matching_group(
            group_sets, assessment_group_id, client.user_id
        )

        return {
            "classId": class_id,
            "assessmentGroupId": assessment_group_id,
            "groupSetName": matched_set.get("groupSetName") if matched_set else None,
            "group": {
                "id": matched_group.get("id"),
                "groupName": matched_group.get("groupName"),
                "people": matched_group.get("people") or [],
            } if matched_group else None,
            "currentUserId": client.user_id,
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/schedule/assessment-documents")
async def api_schedule_assessment_documents(
    class_id: str = Query(...),
    resource_id: str = Query(...),
    assessment_id: Optional[str] = Query(None),
):
    try:
        client = get_client()
        documents = client.get_assessment_documents(
            class_id=class_id,
            resource_id=resource_id,
            assessment_id=assessment_id,
        )
        return {"documents": documents}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/schedule/download-document")
async def api_schedule_download_document(
    url: str = Query(...),
    filename: Optional[str] = Query(None),
):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (
        host.endswith(".blob.core.windows.net") or host.endswith(".binus.ac.id")
    ):
        raise HTTPException(status_code=400, detail="Invalid document URL")

    try:
        resp = requests.get(url, stream=True, timeout=30)
        resp.raise_for_status()

        safe_name = (filename or Path(parsed.path).name or "document").replace('"', "")
        content_type = resp.headers.get("Content-Type") or "application/octet-stream"

        def iter_chunks():
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk

        return StreamingResponse(
            iter_chunks(),
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}"',
            },
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to download document: {e}")


@app.get("/api/schedule/attendance-link")
async def api_schedule_attendance_link(
    class_id: str = Query(...),
    session_id: str = Query(...),
    resource_id: Optional[str] = Query(None),
):
    fallback_url = f"https://lms.binus.ac.id/lms/course/{class_id}/session/{session_id}"
    if resource_id:
        fallback_url += f"?resource={resource_id}"

    try:
        client = get_client()
        data = client.get_session_resource(session_id)
        join_url = data.get("joinUrl") or ""
        is_ended = bool(data.get("isEnded"))

        # Also check resources[] for virtual class / video conference link if joinUrl is empty
        if not join_url:
            for res in data.get("resources") or []:
                res_url = res.get("joinUrl") or res.get("url") or res.get("link")
                if res_url:
                    join_url = res_url
                    break

        can_join_zoom = bool(join_url) and not is_ended
        return {
            "joinUrl": join_url,
            "isEnded": is_ended,
            "canJoinZoom": can_join_zoom,
            "fallbackUrl": fallback_url,
            "deliveryMode": data.get("deliveryModeDesc") or data.get("classDeliveryMode"),
        }
    except Exception as e:
        return {
            "joinUrl": "",
            "isEnded": True,
            "canJoinZoom": False,
            "fallbackUrl": fallback_url,
            "error": str(e),
        }


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
    print(f"👉 Web UI: http://127.0.0.1:{port}")
    print(f"👉 MCP Endpoint: http://127.0.0.1:{port}/mcp")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    start_server()
