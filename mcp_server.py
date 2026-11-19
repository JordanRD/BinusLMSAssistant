import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
from mcp.server.mcpserver import MCPServer
import lms_api
import lms_auth

# Create MCP server instance
mcp = MCPServer("binus-lms-assistant")


def _get_client():
    import server
    return server.get_client()


def _get_thread_cache():
    import server
    return server._thread_cache


@mcp.tool()
def init_session() -> Dict[str, Any]:
    """Inisialisasi sesi LMS: Mengambil profil user, daftar periode akademik, periode aktif, dan daftar mata kuliah."""
    client = _get_client()
    user_name = client.user_name
    role_info = client.auth.get("activeRole") or {}
    role = role_info.get("name", "Student")
    acad_career = role_info.get("academicCareer", "OS1")
    institution = role_info.get("institution", "BNS01")

    periods_data = client.get_periods()
    active_period = client.get_active_period(periods_data)

    periods_list = [
        {
            "code": str(p.get("academicPeriod")),
            "description": p.get("academicPeriodDescription", ""),
            "isRunning": bool(p.get("isRunningPeriod")),
        }
        for p in periods_data
    ]

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


@mcp.tool()
def get_subjects(period: str, include_lab: bool = False) -> Dict[str, Any]:
    """Mengambil daftar mata kuliah yang terdaftar pada periode tertentu.

    Args:
        period: Kode periode akademik (misal '2410', '2420').
        include_lab: Apakah menyertakan komponen LAB selain LEC.
    """
    client = _get_client()
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
                "component": c.get("component", "LEC"),
                "lecturers": [l.get("name") for l in c.get("lecturers", [])],
            })
    return {"courses": unique_courses}


@mcp.tool()
def get_sessions(class_id: str) -> Dict[str, Any]:
    """Mengambil daftar pertemuan/sesi untuk kelas tertentu beserta status aktifnya.

    Args:
        class_id: ID kelas (classId).
    """
    client = _get_client()
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
        is_active = status == 3

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

    return {
        "sessions": sessions_meta,
        "activeSessionId": active_session_id,
        "activeSessionNumber": active_session_number,
    }


@mcp.tool()
def get_posts(class_id: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    """Mengambil thread forum dosen pada sesi kelas tertentu beserta status apakah user sudah membalas/menjawab.

    Args:
        class_id: ID kelas (classId).
        session_id: ID sesi (opsional, jika tidak diberikan akan otomatis memilih sesi aktif).
    """
    client = _get_client()
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
        is_active = status == 3

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

    lecturer_threads = client.get_lecturer_threads(class_id, sid)
    thread_cache = _get_thread_cache()

    def process_thread(t):
        tid = t.get("threadId") or t.get("id")
        if tid:
            thread_cache[tid] = {"class_id": class_id, "session_id": sid}

        try:
            detail = client.get_thread_detail(class_id, tid)
            q_html = detail.get("threadContentText", "")
            author = detail.get("authorFullName") or t.get("authorFullName", "Instructor")
        except Exception:
            detail = {}
            q_html = t.get("threadTitle", "")
            author = t.get("authorFullName", "Instructor")

        has_replied, reply_date = lms_api.is_thread_replied(detail, t)

        return {
            "threadId": tid,
            "sessionId": sid,
            "sessionNumber": num,
            "topicName": topic,
            "title": t.get("threadTitle", "Untitled Thread"),
            "authorName": author,
            "authorRole": t.get("authorRole", "Instructor"),
            "postDate": t.get("postDate", ""),
            "questionText": lms_api.html_to_plain_text(q_html),
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


@mcp.tool()
def get_thread_detail(class_id: str, thread_id: str) -> Dict[str, Any]:
    """Mengambil detail lengkap thread forum dosen termasuk isi pertanyaan dalam bentuk teks polos.

    Args:
        class_id: ID kelas (classId).
        thread_id: ID thread forum (threadId).
    """
    client = _get_client()
    detail = client.get_thread_detail(class_id, thread_id)
    content_html = detail.get("threadContentText", "")
    return {
        "threadId": thread_id,
        "classId": class_id,
        "title": detail.get("threadTitle"),
        "authorName": detail.get("authorFullName"),
        "postDate": detail.get("postDate"),
        "contentPlain": lms_api.html_to_plain_text(content_html),
        "contentHtml": content_html,
        "detail": detail,
    }


@mcp.tool()
def get_comments(
    class_id: str,
    thread_id: str,
    page: int = 1,
    limit: int = 25,
) -> Dict[str, Any]:
    """Mengambil komentar / balasan mahasiswa dan dosen pada suatu thread forum.

    Args:
        class_id: ID kelas (classId).
        thread_id: ID thread forum (threadId).
        page: Nomor halaman (mulai dari 1).
        limit: Batas jumlah komentar per halaman (maks 100).
    """
    client = _get_client()
    result = client.get_thread_comments(class_id, thread_id, page=page, limit=limit)
    return {
        "total": result.get("total", 0),
        "page": page,
        "limit": limit,
        "currentUserId": client.user_id,
        "currentUserName": client.user_name,
        "comments": result.get("datas", []),
    }


@mcp.tool()
def post_answer(
    thread_id: str,
    answer_text: str,
    class_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Mengirim jawaban/balasan mahasiswa ke thread forum dosen di BINUS LMS.

    Args:
        thread_id: ID thread forum yang ingin dijawab.
        answer_text: Teks jawaban/komentar yang akan diposting.
        class_id: ID kelas (opsional jika thread sudah pernah di-fetch).
        session_id: ID sesi (opsional jika thread sudah pernah di-fetch).
    """
    if not answer_text.strip():
        raise ValueError("Answer text cannot be empty.")

    client = _get_client()
    thread_cache = _get_thread_cache()

    cid = class_id
    sid = session_id
    if (not cid or not sid) and thread_id in thread_cache:
        cached = thread_cache[thread_id]
        cid = cid or cached.get("class_id")
        sid = sid or cached.get("session_id")

    client.post_answer(
        thread_id=thread_id,
        answer_text=answer_text.strip(),
        class_id=cid,
        session_id=sid,
    )
    return {"success": True, "message": "Answer posted successfully."}


@mcp.tool()
def get_schedule_assessments(
    period: Optional[str] = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Mengambil seluruh daftar tugas dan asesmen (kuis, tugas individu, kelompok) beserta deadline dan skor.

    Args:
        period: Kode periode (opsional, default periode aktif).
        force_refresh: Memaksa refresh cache API LMS.
    """
    client = _get_client()
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


@mcp.tool()
def get_schedule_team(
    class_id: str,
    assessment_group_id: Optional[str] = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Mengambil informasi kelompok belajar / tim tugas mahasiswa untuk suatu mata kuliah.

    Args:
        class_id: ID kelas (classId).
        assessment_group_id: ID group assessment (opsional).
        force_refresh: Memaksa refresh cache API LMS.
    """
    import server

    client = _get_client()
    group_sets = client.get_class_groups(class_id, force_refresh=force_refresh)
    matched_set, matched_group = server._find_matching_group(
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
        }
        if matched_group
        else None,
        "currentUserId": client.user_id,
    }


@mcp.tool()
def get_assessment_documents(
    class_id: str,
    resource_id: str,
    assessment_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Mengambil berkas / dokumen soal dan materi pendukung dari suatu asesmen tugas.

    Args:
        class_id: ID kelas (classId).
        resource_id: ID resource konten sesi (classSessionContentId).
        assessment_id: ID asesmen (opsional).
    """
    client = _get_client()
    documents = client.get_assessment_documents(
        class_id=class_id,
        resource_id=resource_id,
        assessment_id=assessment_id,
    )
    return {"documents": documents}


@mcp.tool()
def get_attendance_link(
    class_id: str,
    session_id: str,
    resource_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Mengambil tautan presensi / tatap muka virtual (Zoom/Teams) pada suatu sesi kuliah.

    Args:
        class_id: ID kelas (classId).
        session_id: ID sesi (sessionId).
        resource_id: ID resource (opsional).
    """
    fallback_url = f"https://lms.binus.ac.id/lms/course/{class_id}/session/{session_id}"
    if resource_id:
        fallback_url += f"?resource={resource_id}"

    try:
        client = _get_client()
        data = client.get_session_resource(session_id)
        join_url = data.get("joinUrl") or ""
        is_ended = bool(data.get("isEnded"))

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


@mcp.tool()
def relogin() -> Dict[str, Any]:
    """Memicu browser interaktif untuk login ulang ke BINUS LMS dan memperbarui sesi autentikasi."""
    import server

    auth_pkg = lms_auth.trigger_interactive_login()
    server._client = lms_api.LmsApiClient(auth_pkg)
    return {"success": True, "name": auth_pkg.get("name", "User")}


# Build the Starlette streamable HTTP app instance
mcp_app = mcp.streamable_http_app(streamable_http_path="/")


if __name__ == "__main__":
    # If run directly as a script, start in stdio mode (e.g. for Claude Desktop or CLI MCP clients)
    mcp.run(transport="stdio")
