/**
 * Chrome Extension Schedule & Assessments Controller
 * Direct port of static/js/schedule.js + templates/schedule.html logic (CSP-safe Vanilla JS)
 * Active Reminder Window logic (Monday-to-Monday removed):
 * - For Attendance: only on its deadline day (00:00:00 – 23:59:59 of dueDate)
 * - For Other tasks: from max(dueDate - 7 days, dateStart) until dueDate
 */

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const ALL_TYPE_KEYS = [
  "personal_assignment",
  "team_assignment",
  "quiz",
  "project_team",
  "forum_discussion",
  "attendance",
  "other",
];

const state = {
  backendBaseUrl: DEFAULT_BACKEND_URL,
  user: null,
  authError: null,
  isRelogging: false,
  statusBarText: "Ready.",
  periods: [],
  selectedPeriod: "",
  isLoadingPeriods: false,

  schedulePeriod: "",
  scheduleLoading: false,
  scheduleLoaded: false,
  scheduleError: null,
  scheduleAssessments: [],
  scheduleSubjects: [],
  scheduleCategories: ["LEC", "LAB"],
  scheduleSelectedSubjects: [],
  scheduleSelectedTypes: [...ALL_TYPE_KEYS],
  scheduleAvailabilityFilter: "open",
  scheduleSearchQuery: "",
  advFiltersOpen: false,

  teamModalOpen: false,
  teamModalLoading: false,
  teamModalError: null,
  teamModalItem: null,
  teamModalData: null,

  downloadingDocId: null,
  docModalOpen: false,
  docModalItem: null,
  docModalList: [],
  docModalError: null,
};

// ==========================================
// Helper Utilities & Reminder Window Logic
// ==========================================

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseValidDate(isoStr) {
  if (!isoStr || typeof isoStr !== "string" || isoStr.startsWith("0001")) {
    return null;
  }
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
}

function isTaskCompleted(item) {
  return (
    item.status === "Completed" ||
    (item.totalAttempted !== null &&
      item.totalAttempted !== undefined &&
      Number(item.totalAttempted) > 0)
  );
}

function getTodayBounds(now = new Date()) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);

  return { startToday, endToday };
}

/**
 * Returns the reminder active window { windowStart, windowEnd } for an undone task:
 * - For Attendance: 00:00:00.000 to 23:59:59.999 on the deadline (dueDate) day
 * - For Other tasks: max(dueDate - 7 days, dateStart) to dueDate
 */
function getTaskReminderWindow(item) {
  const due = parseValidDate(item.dueDate);
  if (!due) return null;

  const isAtt = getGroupedType(item).key === "attendance";
  if (isAtt) {
    const dayStart = new Date(due);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(due);
    dayEnd.setHours(23, 59, 59, 999);
    return { windowStart: dayStart, windowEnd: dayEnd };
  }

  const dueMinus7d = new Date(due.getTime() - SEVEN_DAYS_MS);
  const start = parseValidDate(item.dateStart);
  const windowStart =
    start && start.getTime() > dueMinus7d.getTime() ? start : dueMinus7d;

  return { windowStart, windowEnd: due };
}

/**
 * Checks if a task is NOT completed and currently falls within its active reminder window:
 * - Attendance: today is the deadline day (00:00 - 23:59)
 * - Other tasks: now is between max(dueDate - 7 days, dateStart) and dueDate
 */
function isTaskInActiveReminderWindow(item, now = new Date()) {
  if (isTaskCompleted(item)) return false;
  const win = getTaskReminderWindow(item);
  if (!win) return false;
  return now >= win.windowStart && now <= win.windowEnd;
}

/**
 * Checks if a task's deadline (dueDate) is specifically today (00:00 - 23:59).
 */
function isTaskDueToday(item, now = new Date()) {
  if (isTaskCompleted(item)) return false;
  const { startToday, endToday } = getTodayBounds(now);
  const due = parseValidDate(item.dueDate);
  return Boolean(due && due >= startToday && due <= endToday);
}

// ==========================================
// Ported Getters & Methods from schedule.js
// ==========================================

function getCardAvailability(item, now = new Date()) {
  const isCompleted = isTaskCompleted(item);
  if (isCompleted) {
    return {
      key: "completed",
      label:
        item.isScored && item.scorePts !== null && item.scorePts !== undefined
          ? `Selesai (${item.scorePts} pts)`
          : "Sudah Selesai",
      badgeClass: "badge-avail-completed",
      icon: "✅",
    };
  }

  const start = parseValidDate(item.dateStart);
  const due = parseValidDate(item.dueDate);

  if (start && now < start) {
    return {
      key: "upcoming",
      label: "Belum Dibuka",
      badgeClass: "badge-avail-upcoming",
      icon: "⏳",
    };
  }

  if (due && now > due) {
    return {
      key: "overdue",
      label: "Tenggat Terlewat",
      badgeClass: "badge-avail-overdue",
      icon: "⚠️",
    };
  }

  if (due) {
    const diffHours = (due - now) / (1000 * 60 * 60);
    if (diffHours <= 72) {
      return {
        key: "urgent",
        label: "Segera Berakhir",
        badgeClass: "badge-avail-urgent",
        icon: "⚡",
      };
    }
  }

  return {
    key: "open",
    label: "Bisa Dikerjakan",
    badgeClass: "badge-avail-open",
    icon: "🟢",
  };
}

function formatScheduleDate(isoStr) {
  if (!isoStr || isoStr.startsWith("0001")) return "-";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agu",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${month} ${year}, ${hh}:${mm}`;
  } catch (e) {
    return isoStr;
  }
}

function formatRelativeDate(item) {
  const now = new Date();
  if (isTaskCompleted(item)) {
    if (item.submissionDate) {
      return `Diserahkan pada ${formatScheduleDate(item.submissionDate)}`;
    }
    return "Tugas telah diselesaikan";
  }

  const start = parseValidDate(item.dateStart);
  const due = parseValidDate(item.dueDate);

  if (start && now < start) {
    const diffMs = start - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays <= 1 ? "Dibuka besok" : `Dibuka dalam ${diffDays} hari`;
  }

  if (due) {
    const diffMs = due - now;
    if (diffMs < 0) {
      const pastDays = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
      return pastDays <= 0
        ? "Tenggat terlewat beberapa jam lalu"
        : `Tenggat terlewat ${pastDays} hari lalu`;
    }
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) {
      const remHours = diffHours % 24;
      return remHours > 0
        ? `Sisa ${diffDays} hari ${remHours} jam`
        : `Sisa ${diffDays} hari`;
    }
    return `Sisa ${diffHours} jam lagi`;
  }

  return "";
}

function getGroupedType(item) {
  const lam = (item.lamType || "").toUpperCase();
  const act = (item.activityName || "").toLowerCase();
  const title = (item.title || "").toLowerCase();

  if (
    lam === "PAS" ||
    act.includes("personal assignment") ||
    title.includes("personal assignment")
  ) {
    return { key: "personal_assignment", label: "Personal Assignment" };
  }
  if (
    lam === "TAS" ||
    lam === "LTS" ||
    act.includes("team assignment") ||
    title.includes("team assignment")
  ) {
    return { key: "team_assignment", label: "Team Assignment" };
  }
  if (
    lam === "QIZ" ||
    lam === "QZ" ||
    act.includes("quiz") ||
    title.includes("quiz")
  ) {
    return { key: "quiz", label: "Quiz" };
  }
  if (lam === "LPRT" || act.includes("project") || title.includes("project")) {
    return { key: "project_team", label: "Project Team" };
  }
  if (lam === "FOD" || act.includes("forum") || title.includes("forum")) {
    return { key: "forum_discussion", label: "Forum Discussion" };
  }
  if (lam === "ATT" || act.includes("attendance") || act.includes("presensi")) {
    return { key: "attendance", label: "Attendance / Presensi" };
  }
  return { key: "other", label: "Lainnya" };
}

function getTypeLabel(item) {
  return getGroupedType(item).label;
}

function getScheduleCounts() {
  const now = new Date();
  let open = 0,
    upcoming = 0,
    completed = 0,
    overdue = 0,
    reminderWindow = 0,
    dueToday = 0;

  state.scheduleAssessments.forEach((item) => {
    const st = getCardAvailability(item, now);
    if (st.key === "completed") completed++;
    else if (st.key === "upcoming") upcoming++;
    else if (st.key === "overdue") overdue++;
    else open++;

    if (isTaskInActiveReminderWindow(item, now)) {
      reminderWindow++;
    }
    if (isTaskDueToday(item, now)) {
      dueToday++;
    }
  });

  return {
    total: state.scheduleAssessments.length,
    open,
    upcoming,
    completed,
    overdue,
    reminderWindow,
    dueToday,
  };
}

function getScheduleCountByComp() {
  let lec = 0,
    lab = 0;
  state.scheduleAssessments.forEach((item) => {
    if (item.component === "LEC") lec++;
    else if (item.component === "LAB") lab++;
  });
  return { LEC: lec, LAB: lab };
}

function getAvailableScheduleTypes() {
  const groups = {
    personal_assignment: {
      key: "personal_assignment",
      label: "Personal Assignment",
      count: 0,
    },
    team_assignment: {
      key: "team_assignment",
      label: "Team Assignment",
      count: 0,
    },
    quiz: { key: "quiz", label: "Quiz", count: 0 },
    project_team: {
      key: "project_team",
      label: "Project Team",
      count: 0,
    },
    forum_discussion: {
      key: "forum_discussion",
      label: "Forum Discussion",
      count: 0,
    },
    attendance: {
      key: "attendance",
      label: "Attendance / Presensi",
      count: 0,
    },
    other: { key: "other", label: "Lainnya", count: 0 },
  };

  state.scheduleAssessments.forEach((item) => {
    const grp = getGroupedType(item);
    if (groups[grp.key]) {
      groups[grp.key].count++;
    } else {
      groups.other.count++;
    }
  });

  return Object.values(groups).filter((g) => g.count > 0);
}

function getVisibleScheduleSubjects() {
  const list = [];
  state.scheduleSubjects.forEach((sub) => {
    if (state.scheduleCategories.includes(sub.component)) {
      const key = `${sub.classId}_${sub.component}`;
      const count = state.scheduleAssessments.filter(
        (a) => a.classId === sub.classId && a.component === sub.component,
      ).length;
      list.push({
        key,
        classId: sub.classId,
        component: sub.component,
        courseCode: sub.courseCode,
        courseName: sub.courseName,
        count,
      });
    }
  });
  return list;
}

function getIsScheduleFiltered() {
  const allTypesCount = getAvailableScheduleTypes().length;
  return (
    state.scheduleCategories.length < 2 ||
    state.scheduleAvailabilityFilter !== "open" ||
    (state.scheduleSearchQuery && state.scheduleSearchQuery.trim() !== "") ||
    state.scheduleSelectedSubjects.length < state.scheduleSubjects.length ||
    state.scheduleSelectedTypes.length < allTypesCount
  );
}

function getFilteredAssessments() {
  const now = new Date();
  const query = (state.scheduleSearchQuery || "").trim().toLowerCase();

  return state.scheduleAssessments.filter((item) => {
    // 1. Component filter (LEC/LAB)
    if (!state.scheduleCategories.includes(item.component)) return false;

    // 2. Subject filter
    const subjKey = `${item.classId}_${item.component}`;
    if (
      state.scheduleSelectedSubjects.length > 0 &&
      !state.scheduleSelectedSubjects.includes(subjKey)
    ) {
      return false;
    }

    // 3. Assessment grouped type filter
    const grp = getGroupedType(item);
    if (!state.scheduleSelectedTypes.includes(grp.key)) return false;

    // 4. Availability / status filter (including reminder_window and today)
    const avail = getCardAvailability(item, now);
    if (state.scheduleAvailabilityFilter === "reminder_window") {
      if (!isTaskInActiveReminderWindow(item, now)) return false;
    } else if (state.scheduleAvailabilityFilter === "today") {
      if (!isTaskDueToday(item, now)) return false;
    } else if (
      state.scheduleAvailabilityFilter === "open" &&
      avail.key !== "open" &&
      avail.key !== "urgent"
    ) {
      return false;
    } else if (
      state.scheduleAvailabilityFilter === "upcoming" &&
      avail.key !== "upcoming"
    ) {
      return false;
    } else if (
      state.scheduleAvailabilityFilter === "completed" &&
      avail.key !== "completed"
    ) {
      return false;
    } else if (
      state.scheduleAvailabilityFilter === "overdue" &&
      avail.key !== "overdue"
    ) {
      return false;
    }

    // 5. Search query
    if (query) {
      const targetText =
        `${item.title} ${item.courseName} ${item.courseCode} ${item.activityName}`.toLowerCase();
      if (!targetText.includes(query)) return false;
    }

    return true;
  });
}

function isTeamAssessment(item) {
  const key = getGroupedType(item).key;
  return key === "team_assignment" || key === "project_team";
}

function hasDownloadableDoc(item) {
  const key = getGroupedType(item).key;
  return (
    key === "personal_assignment" ||
    key === "team_assignment" ||
    key === "project_team"
  );
}

function getCardActionLabel(item) {
  const key = getGroupedType(item).key;
  if (key === "forum_discussion") return "Buka Detail Forum";
  if (key === "attendance") return "Buka Zoom / Kelas";
  return "Buka di LMS";
}

function getWhatsAppUrl(phone) {
  if (!phone) return "";
  let digits = String(phone).replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) {
    digits = "62" + digits.slice(1);
  }
  return digits ? `https://wa.me/${digits}` : "";
}

function getInitials(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function getDocFilename(doc) {
  const name = (doc?.name || "document").trim();
  const ext = (doc?.type || "").trim().replace(/^\./, "");
  if (ext && !name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
    return `${name}.${ext}`;
  }
  return name;
}

// ==========================================
// Storage & Background Sync
// ==========================================

async function loadSavedPreferences() {
  if (!globalThis.chrome?.storage?.local) return;
  const stored = await chrome.storage.local.get([
    "backendBaseUrl",
    "schedulePeriod",
    "scheduleCategories",
    "scheduleAvailabilityFilter",
  ]);
  if (stored.backendBaseUrl) {
    state.backendBaseUrl = stored.backendBaseUrl.replace(/\/+$/, "");
  }
  if (stored.schedulePeriod) {
    state.schedulePeriod = stored.schedulePeriod;
  }
  if (Array.isArray(stored.scheduleCategories) && stored.scheduleCategories.length > 0) {
    state.scheduleCategories = stored.scheduleCategories;
  }
  if (stored.scheduleAvailabilityFilter) {
    state.scheduleAvailabilityFilter =
      stored.scheduleAvailabilityFilter === "this_week"
        ? "reminder_window"
        : stored.scheduleAvailabilityFilter;
  }
}

async function savePreferences() {
  if (!globalThis.chrome?.storage?.local) return;
  await chrome.storage.local.set({
    backendBaseUrl: state.backendBaseUrl,
    schedulePeriod: state.schedulePeriod,
    scheduleCategories: state.scheduleCategories,
    scheduleAvailabilityFilter: state.scheduleAvailabilityFilter,
  });
}

async function notifyBackgroundSync(forceNotify = false) {
  if (!globalThis.chrome?.runtime?.sendMessage) return;
  try {
    await chrome.runtime.sendMessage({
      type: "SYNC_ASSESSMENTS_STATE",
      assessments: state.scheduleAssessments,
      forceNotify,
    });
  } catch (_) {
    // Ignore if service worker is waking up
  }
}

// ==========================================
// API Actions
// ==========================================

async function loadInitData() {
  state.statusBarText = "⏳ Menginisialisasi sesi & periode...";
  state.isLoadingPeriods = true;
  renderHeaderAndStatus();

  try {
    const res = await fetch(`${state.backendBaseUrl}/api/init`);
    const data = await res.json();

    if (data.error) {
      state.statusBarText = `⚠️ ${data.error}`;
      state.authError = "Not authenticated";
      renderHeaderAndStatus();
      return;
    }

    state.authError = null;
    state.user = data.user;
    state.periods = data.periods || [];
    state.selectedPeriod =
      data.activePeriod || (state.periods[0] ? state.periods[0].code : "");

    if (!state.schedulePeriod || !state.periods.some((p) => p.code === state.schedulePeriod)) {
      state.schedulePeriod = state.selectedPeriod;
    }

    state.statusBarText = "✅ Terhubung ke BINUS LMS Assistant Backend.";
    renderHeaderAndStatus();
    renderPeriodsSelect();

    await loadScheduleAssessments();
  } catch (err) {
    state.statusBarText = `❌ Gagal terhubung ke backend (${state.backendBaseUrl}): ${err.message}`;
    state.scheduleError = `Pastikan server FastAPI berjalan di ${state.backendBaseUrl}. (${err.message})`;
    renderAll();
  } finally {
    state.isLoadingPeriods = false;
  }
}

async function loadScheduleAssessments(forceRefresh = false) {
  if (!state.schedulePeriod) {
    state.schedulePeriod =
      state.selectedPeriod || (state.periods[0] ? state.periods[0].code : "2611");
  }
  state.scheduleLoading = true;
  state.scheduleError = null;
  renderAll();

  try {
    const url = `${state.backendBaseUrl}/api/schedule/assessments?period=${encodeURIComponent(
      state.schedulePeriod,
    )}${forceRefresh ? "&force_refresh=true" : ""}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      state.scheduleError = data.error;
      return;
    }

    state.scheduleAssessments = data.assessments || [];
    state.scheduleSubjects = data.subjects || [];
    state.scheduleSelectedSubjects = state.scheduleSubjects.map(
      (s) => `${s.classId}_${s.component}`,
    );
    state.scheduleLoaded = true;

    await savePreferences();
    await notifyBackgroundSync(false);
  } catch (err) {
    state.scheduleError = `Gagal memuat jadwal: ${err.message}`;
  } finally {
    state.scheduleLoading = false;
    renderAll();
  }
}

async function triggerRelogin() {
  state.isRelogging = true;
  state.statusBarText =
    "🌐 Chrome dibuka oleh backend. Silakan login ke BINUS LMS di jendela browser...";
  renderHeaderAndStatus();

  try {
    const res = await fetch(`${state.backendBaseUrl}/api/relogin`, {
      method: "POST",
    });
    const data = await res.json();
    if (data.success) {
      state.statusBarText = `🎉 Login berhasil untuk ${data.name}!`;
      await loadInitData();
    } else {
      state.statusBarText = `❌ Login gagal: ${data.error}`;
    }
  } catch (err) {
    state.statusBarText = `❌ Error: ${err.message}`;
  } finally {
    state.isRelogging = false;
    renderHeaderAndStatus();
  }
}

async function openTeamModal(item) {
  state.teamModalItem = item;
  state.teamModalData = null;
  state.teamModalError = null;
  state.teamModalOpen = true;
  state.teamModalLoading = true;
  renderTeamModal();

  try {
    const params = new URLSearchParams({ class_id: item.classId });
    if (item.assessmentGroupId) {
      params.set("assessment_group_id", item.assessmentGroupId);
    }
    const res = await fetch(
      `${state.backendBaseUrl}/api/schedule/team?${params.toString()}`,
    );
    const data = await res.json();
    if (!res.ok || data.error) {
      state.teamModalError = data.error || `HTTP ${res.status}`;
      return;
    }
    state.teamModalData = data;
  } catch (err) {
    state.teamModalError = `Gagal memuat data tim: ${err.message}`;
  } finally {
    state.teamModalLoading = false;
    renderTeamModal();
  }
}

function closeTeamModal() {
  state.teamModalOpen = false;
  renderTeamModal();
}

function triggerFileDownload(doc) {
  if (!doc || !doc.url) return;
  const filename = getDocFilename(doc);
  const downloadUrl = `${state.backendBaseUrl}/api/schedule/download-document?url=${encodeURIComponent(
    doc.url,
  )}&filename=${encodeURIComponent(filename)}`;

  if (globalThis.chrome?.tabs?.create) {
    chrome.tabs.create({ url: downloadUrl, active: false });
  } else {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

async function downloadAssessmentDoc(item) {
  if (!item || !item.classId || !item.classSessionContentId) {
    state.docModalItem = item;
    state.docModalList = [];
    state.docModalError = "ID dokumen tugas tidak tersedia untuk item ini.";
    state.docModalOpen = true;
    renderDocModal();
    return;
  }

  state.downloadingDocId = item.id;
  state.docModalItem = item;
  state.docModalList = [];
  state.docModalError = null;
  renderCardsGrid();

  try {
    const params = new URLSearchParams({
      class_id: item.classId,
      resource_id: item.classSessionContentId,
    });
    if (item.assessmentId) {
      params.set("assessment_id", item.assessmentId);
    }
    const res = await fetch(
      `${state.backendBaseUrl}/api/schedule/assessment-documents?${params.toString()}`,
    );
    const data = await res.json();
    if (!res.ok || data.error) {
      state.docModalError = data.error || `HTTP ${res.status}`;
      state.docModalOpen = true;
      renderDocModal();
      return;
    }
    const docs = data.documents || [];
    if (docs.length === 1) {
      triggerFileDownload(docs[0]);
    } else {
      state.docModalList = docs;
      state.docModalOpen = true;
      renderDocModal();
    }
  } catch (err) {
    state.docModalError = `Gagal mengambil dokumen: ${err.message}`;
    state.docModalOpen = true;
    renderDocModal();
  } finally {
    state.downloadingDocId = null;
    renderCardsGrid();
  }
}

function closeDocModal() {
  state.docModalOpen = false;
  renderDocModal();
}

function openExternalUrl(url) {
  if (!url) return;
  if (globalThis.chrome?.tabs?.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

async function openAssessmentInLms(item) {
  const key = getGroupedType(item).key;

  if (key === "forum_discussion") {
    const params = new URLSearchParams({
      period: state.schedulePeriod || "",
      class_id: item.classId || "",
      session_id: item.classSessionId || "",
      session_number: item.sessionNumber != null ? String(item.sessionNumber) : "",
      open_detail: "1",
    });
    openExternalUrl(`${state.backendBaseUrl}/forum?${params.toString()}`);
    return;
  }

  if (key === "attendance" && item.classId && item.classSessionId) {
    try {
      const params = new URLSearchParams({
        class_id: item.classId,
        session_id: item.classSessionId,
      });
      if (item.classSessionContentId) {
        params.set("resource_id", item.classSessionContentId);
      }
      const res = await fetch(
        `${state.backendBaseUrl}/api/schedule/attendance-link?${params.toString()}`,
      );
      const data = await res.json();
      const targetUrl =
        data.canJoinZoom && data.joinUrl
          ? data.joinUrl
          : data.fallbackUrl || item.deepLink;
      openExternalUrl(targetUrl || "https://lms.binus.ac.id");
    } catch (_) {
      openExternalUrl(item.deepLink || "https://lms.binus.ac.id");
    }
    return;
  }

  if (item.deepLink) {
    openExternalUrl(item.deepLink);
  }
}

// ==========================================
// Filter Mutations
// ==========================================

function toggleScheduleCategory(cat) {
  if (state.scheduleCategories.includes(cat)) {
    if (state.scheduleCategories.length > 1) {
      state.scheduleCategories = state.scheduleCategories.filter((c) => c !== cat);
    }
  } else {
    state.scheduleCategories.push(cat);
  }
  savePreferences();
  renderAll();
}

function toggleScheduleType(typeKey) {
  if (state.scheduleSelectedTypes.includes(typeKey)) {
    if (state.scheduleSelectedTypes.length > 1) {
      state.scheduleSelectedTypes = state.scheduleSelectedTypes.filter(
        (t) => t !== typeKey,
      );
    }
  } else {
    state.scheduleSelectedTypes.push(typeKey);
  }
  renderAll();
}

function toggleScheduleSubject(subKey) {
  if (state.scheduleSelectedSubjects.includes(subKey)) {
    if (state.scheduleSelectedSubjects.length > 1) {
      state.scheduleSelectedSubjects = state.scheduleSelectedSubjects.filter(
        (k) => k !== subKey,
      );
    }
  } else {
    state.scheduleSelectedSubjects.push(subKey);
  }
  renderAll();
}

function selectAllScheduleTypes() {
  state.scheduleSelectedTypes = [...ALL_TYPE_KEYS];
  renderAll();
}

function clearAllScheduleTypes() {
  state.scheduleSelectedTypes = [];
  renderAll();
}

function selectAllScheduleSubjects() {
  state.scheduleSelectedSubjects = state.scheduleSubjects.map(
    (s) => `${s.classId}_${s.component}`,
  );
  renderAll();
}

function clearAllScheduleSubjects() {
  state.scheduleSelectedSubjects = [];
  renderAll();
}

function resetScheduleFilters() {
  state.scheduleCategories = ["LEC", "LAB"];
  state.scheduleAvailabilityFilter = "open";
  state.scheduleSearchQuery = "";
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";
  state.scheduleSelectedTypes = [...ALL_TYPE_KEYS];
  state.scheduleSelectedSubjects = state.scheduleSubjects.map(
    (s) => `${s.classId}_${s.component}`,
  );
  savePreferences();
  renderAll();
}

// ==========================================
// DOM Rendering
// ==========================================

function renderHeaderAndStatus() {
  const statusEl = document.getElementById("statusBarText");
  if (statusEl) {
    statusEl.textContent = state.statusBarText;
  }

  const userPill = document.getElementById("userPill");
  if (userPill) {
    if (state.authError) {
      userPill.innerHTML = `<span style="color: var(--danger);">${escapeHtml(state.authError)}</span>`;
    } else if (!state.user) {
      userPill.innerHTML = `<span>Loading user...</span>`;
    } else {
      userPill.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px;">
          <strong>${escapeHtml(state.user.name)}</strong>
          <span>•</span>
          <span>${escapeHtml(state.user.role)} (${escapeHtml(state.user.academicCareer)})</span>
        </div>
      `;
    }
  }

  const reloginBtn = document.getElementById("reloginBtn");
  const reloginSpinner = document.getElementById("reloginSpinner");
  const reloginBtnText = document.getElementById("reloginBtnText");
  if (reloginBtn && reloginSpinner && reloginBtnText) {
    reloginBtn.disabled = state.isRelogging;
    reloginSpinner.classList.toggle("hidden", !state.isRelogging);
    reloginBtnText.textContent = state.isRelogging ? "Opening Chrome..." : "🔑 Re-Login";
  }
}

function renderPeriodsSelect() {
  const select = document.getElementById("periodSelect");
  if (!select) return;

  select.disabled = state.scheduleLoading;
  select.innerHTML = state.periods
    .map(
      (p) =>
        `<option value="${escapeHtml(p.code)}" ${
          p.code === state.schedulePeriod ? "selected" : ""
        }>${escapeHtml(p.description)}</option>`,
    )
    .join("");
}

function renderSummaryBadges(counts) {
  // Active Reminder Window Card (Attendance: dueDate day 00-23 | Others: max(dueDate - 7d, startDate)..dueDate)
  const activeReminderTitle = document.getElementById("activeReminderTitle");
  const activeReminderCountBadge = document.getElementById("activeReminderCountBadge");
  const activeReminderCard = document.getElementById("activeReminderCard");

  if (activeReminderTitle) {
    activeReminderTitle.textContent =
      counts.reminderWindow > 0
        ? `${counts.reminderWindow} Tugas Perlu Dikerjakan`
        : "Tidak Ada Tugas Aktif";
  }
  if (activeReminderCountBadge) {
    activeReminderCountBadge.textContent = String(counts.reminderWindow);
  }
  if (activeReminderCard) {
    activeReminderCard.classList.toggle(
      "active",
      state.scheduleAvailabilityFilter === "reminder_window",
    );
  }

  // Due Today Reminder Badge
  const todayReminderCard = document.getElementById("todayReminderCard");
  const todayReminderSubtitle = document.getElementById("todayReminderSubtitle");
  const todayReminderTitle = document.getElementById("todayReminderTitle");
  const todayTaskCountBadge = document.getElementById("todayTaskCountBadge");

  if (todayTaskCountBadge) {
    todayTaskCountBadge.textContent = String(counts.dueToday);
  }
  if (todayReminderCard) {
    todayReminderCard.classList.toggle("clear", counts.dueToday === 0);
    todayReminderCard.classList.toggle(
      "active",
      state.scheduleAvailabilityFilter === "today",
    );
  }
  if (todayReminderSubtitle) {
    todayReminderSubtitle.textContent =
      counts.dueToday > 0
        ? "⚠️ Tenggat Hari Ini!"
        : "🔔 Tenggat Hari Ini (00:00–23:59)";
  }
  if (todayReminderTitle) {
    todayReminderTitle.textContent =
      counts.dueToday > 0
        ? `${counts.dueToday} Tugas Jatuh Tempo Hari Ini`
        : "Aman, tidak ada tenggat hari ini";
  }
}

function renderFilterControls(counts, compCounts) {
  const refreshBtn = document.getElementById("refreshBtn");
  const refreshIcon = document.getElementById("refreshIcon");
  const periodSelect = document.getElementById("periodSelect");

  if (refreshBtn) refreshBtn.disabled = state.scheduleLoading;
  if (periodSelect) periodSelect.disabled = state.scheduleLoading;
  if (refreshIcon) refreshIcon.classList.toggle("spin", state.scheduleLoading);

  // Error banner
  const errorBanner = document.getElementById("scheduleErrorBanner");
  if (errorBanner) {
    if (state.scheduleError) {
      errorBanner.textContent = state.scheduleError;
      errorBanner.classList.remove("hidden");
    } else {
      errorBanner.classList.add("hidden");
    }
  }

  // Component pills
  const btnCatLEC = document.getElementById("btnCatLEC");
  const btnCatLAB = document.getElementById("btnCatLAB");
  const countCompLEC = document.getElementById("countCompLEC");
  const countCompLAB = document.getElementById("countCompLAB");

  if (btnCatLEC)
    btnCatLEC.classList.toggle("active", state.scheduleCategories.includes("LEC"));
  if (btnCatLAB)
    btnCatLAB.classList.toggle("active", state.scheduleCategories.includes("LAB"));
  if (countCompLEC) countCompLEC.textContent = String(compCounts.LEC);
  if (countCompLAB) countCompLAB.textContent = String(compCounts.LAB);

  // Availability counts
  const setCount = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };
  setCount("countAvailAll", counts.total);
  setCount("countAvailReminderWindow", counts.reminderWindow);
  setCount("countAvailToday", counts.dueToday);
  setCount("countAvailOpen", counts.open);
  setCount("countAvailUpcoming", counts.upcoming);
  setCount("countAvailCompleted", counts.completed);
  setCount("countAvailOverdue", counts.overdue);

  const availContainer = document.getElementById("availabilityTabsContainer");
  if (availContainer) {
    availContainer.querySelectorAll("button[data-avail]").forEach((btn) => {
      const key = btn.getAttribute("data-avail");
      btn.classList.toggle("active", state.scheduleAvailabilityFilter === key);
    });
  }

  const availTypes = getAvailableScheduleTypes();
  const visibleSubjects = getVisibleScheduleSubjects();

  // Advanced filter toggle & summary badge
  const toggleAdvBtn = document.getElementById("toggleAdvFiltersBtn");
  const advBadge = document.getElementById("advFilterBadge");
  const advDrawer = document.getElementById("advancedFiltersDrawer");

  const activeTypesCount = availTypes.filter((t) =>
    state.scheduleSelectedTypes.includes(t.key),
  ).length;
  const activeSubjCount = visibleSubjects.filter((s) =>
    state.scheduleSelectedSubjects.includes(s.key),
  ).length;
  const isAdvCustom =
    (availTypes.length > 0 && activeTypesCount < availTypes.length) ||
    (visibleSubjects.length > 0 && activeSubjCount < visibleSubjects.length);

  if (advBadge) {
    advBadge.textContent = isAdvCustom
      ? `${activeTypesCount}/${availTypes.length} · ${activeSubjCount}/${visibleSubjects.length}`
      : "Semua";
  }
  if (toggleAdvBtn) {
    toggleAdvBtn.classList.toggle("active", state.advFiltersOpen || isAdvCustom);
  }
  if (advDrawer) {
    advDrawer.classList.toggle("hidden", !state.advFiltersOpen);
  }

  // Types pills
  const typesContainer = document.getElementById("typesPillsContainer");
  if (typesContainer) {
    typesContainer.innerHTML = availTypes
      .map((t) => {
        const isActive = state.scheduleSelectedTypes.includes(t.key);
        return `
          <button
            type="button"
            class="filter-pill ${isActive ? "active" : ""}"
            data-type-key="${escapeHtml(t.key)}"
          >
            <span>${escapeHtml(t.label)}</span>
            <span class="pill-counter">${t.count}</span>
          </button>
        `;
      })
      .join("");
  }

  // Subjects pills
  const subjectsContainer = document.getElementById("subjectsPillsContainer");
  if (subjectsContainer) {
    subjectsContainer.innerHTML = visibleSubjects
      .map((sub) => {
        const isActive = state.scheduleSelectedSubjects.includes(sub.key);
        const compBadgeClass =
          sub.component === "LEC" ? "badge-comp-lec" : "badge-comp-lab";
        return `
          <button
            type="button"
            class="filter-pill ${isActive ? "active" : ""}"
            data-subject-key="${escapeHtml(sub.key)}"
            title="${escapeHtml(sub.courseCode)} — ${escapeHtml(sub.courseName)}"
          >
            <span
              style="font-size: 0.65rem; padding: 0 4px; border-radius: 3px; font-weight: 700;"
              class="${compBadgeClass}"
            >${escapeHtml(sub.component)}</span>
            <span>${escapeHtml(sub.courseName)}</span>
            <span class="pill-counter">${sub.count}</span>
          </button>
        `;
      })
      .join("");
  }
}

function renderCardsGrid() {
  const filtered = getFilteredAssessments();
  const isFiltered = getIsScheduleFiltered();

  const filteredCountText = document.getElementById("filteredCountText");
  const totalCountText = document.getElementById("totalCountText");
  const resetFiltersBtn = document.getElementById("resetFiltersBtn");
  const loadingState = document.getElementById("loadingState");
  const emptyState = document.getElementById("emptyState");
  const cardsGrid = document.getElementById("cardsGrid");

  if (filteredCountText) filteredCountText.textContent = String(filtered.length);
  if (totalCountText)
    totalCountText.textContent = String(state.scheduleAssessments.length);
  if (resetFiltersBtn) resetFiltersBtn.classList.toggle("hidden", !isFiltered);

  if (state.scheduleLoading) {
    loadingState?.classList.remove("hidden");
    emptyState?.classList.add("hidden");
    cardsGrid?.classList.add("hidden");
    return;
  }

  loadingState?.classList.add("hidden");

  if (filtered.length === 0) {
    emptyState?.classList.remove("hidden");
    cardsGrid?.classList.add("hidden");
    return;
  }

  emptyState?.classList.add("hidden");
  cardsGrid?.classList.remove("hidden");

  const now = new Date();

  cardsGrid.innerHTML = filtered
    .map((item) => {
      const avail = getCardAvailability(item, now);
      const compClass =
        item.component === "LEC" ? "badge-comp-lec" : "badge-comp-lab";
      const compLabel = item.component === "LEC" ? "LEC" : "LAB";
      const typeLabel = getTypeLabel(item);
      const groupedType = getGroupedType(item);

      const isInReminderWindow = isTaskInActiveReminderWindow(item, now);
      const isDueToday = isTaskDueToday(item, now);

      const dueColor =
        avail.key === "overdue"
          ? "color: var(--danger);"
          : avail.key === "urgent"
            ? "color: var(--warning);"
            : "color: var(--text);";

      const relColor =
        avail.key === "overdue"
          ? "color: var(--danger);"
          : avail.key === "urgent"
            ? "color: var(--warning);"
            : "color: var(--primary);";

      const isDownloading = state.downloadingDocId === item.id;
      const showDownload = hasDownloadableDoc(item);
      const showTeam = isTeamAssessment(item);
      const actionLabel = getCardActionLabel(item);
      const actionArrow = groupedType.key === "forum_discussion" ? "→" : "↗";
      const relText = formatRelativeDate(item);

      return `
        <div class="assessment-card" data-item-id="${escapeHtml(item.id)}">
          <div class="assessment-card-main">
            <div class="card-top-row">
              <div class="card-badges-left">
                <span class="badge ${compClass}" title="${item.component === "LEC" ? "Theory (LEC)" : "Practicum (LAB)"}">${compLabel}</span>
                <span class="badge badge-type-tag">${escapeHtml(typeLabel)}</span>
                ${
                  isDueToday
                    ? `<span class="badge badge-today-tag">🔔 Hari Ini</span>`
                    : isInReminderWindow
                      ? `<span class="badge badge-week-tag">📌 Aktif</span>`
                      : ""
                }
              </div>

              <span class="badge ${avail.badgeClass}">
                <span>${avail.icon}</span>
                <span>${escapeHtml(avail.label)}</span>
              </span>
            </div>

            <div class="card-course-meta">
              ${escapeHtml(item.courseCode)} • ${escapeHtml(item.classCode)} — ${escapeHtml(item.courseName)}
            </div>

            <div class="card-title-row">
              <div class="card-title">${escapeHtml(item.title)}</div>

              <div class="card-inline-tags">
                ${
                  item.sessionNumber
                    ? `<span class="meta-chip">Sesi ${escapeHtml(item.sessionNumber)}</span>`
                    : ""
                }
                ${
                  item.lamWeight
                    ? `<span class="meta-chip">Bobot: ${escapeHtml(item.lamWeight)}</span>`
                    : ""
                }
                ${
                  item.isScored && item.scorePts !== null && item.scorePts !== undefined
                    ? `<span class="meta-chip-score">Nilai: ${escapeHtml(item.scorePts)}</span>`
                    : ""
                }
              </div>
            </div>
          </div>

          <div class="assessment-card-dates">
            <div class="date-info-compact">
              <div class="date-line">
                <span class="date-item">
                  <span class="date-label">Mulai:</span>
                  <span>${escapeHtml(formatScheduleDate(item.dateStart))}</span>
                </span>
                <span class="date-item">
                  <span class="date-label">Tenggat:</span>
                  <span style="font-weight: 700; ${dueColor}">${escapeHtml(formatScheduleDate(item.dueDate))}</span>
                </span>
              </div>
              ${
                relText
                  ? `<div style="font-size: 0.68rem; font-weight: 600; ${relColor}">${escapeHtml(relText)}</div>`
                  : ""
              }
            </div>

            <div class="card-actions-row">
              ${
                showDownload
                  ? `<button
                      type="button"
                      class="btn-download-doc"
                      data-action="download-doc"
                      data-item-id="${escapeHtml(item.id)}"
                      ${isDownloading ? "disabled" : ""}
                    >
                      <span class="${isDownloading ? "spin" : ""}">${
                        isDownloading ? "⏳" : "📥"
                      }</span>
                      <span>${isDownloading ? "Unduh..." : "Dokumen"}</span>
                    </button>`
                  : ""
              }
              ${
                showTeam
                  ? `<button
                      type="button"
                      class="btn-view-team"
                      data-action="view-team"
                      data-item-id="${escapeHtml(item.id)}"
                    >
                      <span>👥</span>
                      <span>Tim</span>
                    </button>`
                  : ""
              }
              <span class="card-open-link">
                <span>${escapeHtml(actionLabel)}</span>
                <span>${actionArrow}</span>
              </span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTeamModal() {
  const overlay = document.getElementById("teamModalOverlay");
  const titleEl = document.getElementById("teamModalTitle");
  const subtitleEl = document.getElementById("teamModalSubtitle");
  const bodyEl = document.getElementById("teamModalBody");
  if (!overlay || !titleEl || !subtitleEl || !bodyEl) return;

  overlay.classList.toggle("active", state.teamModalOpen);
  if (!state.teamModalOpen) return;

  const item = state.teamModalItem;
  const data = state.teamModalData;

  titleEl.textContent = data?.group?.groupName
    ? `${data.group.groupName} — ${item?.title || "Team"}`
    : item?.title || "View Team";
  subtitleEl.textContent = item
    ? `${item.courseCode} • ${item.classCode} — ${item.courseName}`
    : "";

  if (state.teamModalLoading) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 36px 16px;">
        <div class="spinner" style="margin: 0 auto 12px auto;"></div>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Memuat anggota tim...</p>
      </div>
    `;
    return;
  }

  if (state.teamModalError) {
    bodyEl.innerHTML = `
      <div class="status-bar" style="border-color: var(--danger); color: var(--danger);">
        <span>${escapeHtml(state.teamModalError)}</span>
      </div>
    `;
    return;
  }

  const people = data?.group?.people || [];
  if (!data?.group || people.length === 0) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 8px;">👥</div>
        <p style="font-weight: 600; color: var(--text);">Data tim tidak ditemukan</p>
        <p style="font-size: 0.85rem; margin-top: 4px;">Belum ada anggota kelompok yang terdaftar untuk tugas ini.</p>
      </div>
    `;
    return;
  }

  bodyEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div class="team-group-banner">
        <div>
          <div style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">
            ${escapeHtml(data.groupSetName || "Group")}
          </div>
          <div style="font-size: 1.05rem; font-weight: 800; color: var(--primary);">
            ${escapeHtml(data.group.groupName || "Team")}
          </div>
        </div>
        <span class="badge badge-type-tag">${people.length} Anggota</span>
      </div>

      <div class="team-members-list">
        ${people
          .map((person) => {
            const isCurrentUser =
              person.userId && person.userId === data.currentUserId;
            const waUrl = getWhatsAppUrl(person.phoneNumber);
            const initials = getInitials(person.name);
            return `
              <div class="team-member-card">
                <div class="team-member-left">
                  <div class="team-member-avatar-fallback">${escapeHtml(initials)}</div>
                  <div class="team-member-info">
                    <div class="team-member-name">
                      <span>${escapeHtml(person.name)}</span>
                      ${
                        isCurrentUser
                          ? `<span class="badge badge-comp-lec" style="font-size: 0.68rem; padding: 1px 6px;">Anda</span>`
                          : ""
                      }
                    </div>
                    <div class="team-member-meta">
                      ${
                        person.code
                          ? `<span>🆔 <span>${escapeHtml(person.code)}</span></span>`
                          : ""
                      }
                      ${
                        person.email
                          ? `<span>✉️ <a href="mailto:${escapeHtml(
                              person.email,
                            )}">${escapeHtml(person.email)}</a></span>`
                          : ""
                      }
                      ${
                        person.phoneNumber
                          ? `<span>📞 <span>${escapeHtml(person.phoneNumber)}</span></span>`
                          : ""
                      }
                    </div>
                  </div>
                </div>
                ${
                  waUrl
                    ? `<a class="btn-whatsapp" href="${escapeHtml(
                        waUrl,
                      )}" target="_blank" rel="noopener noreferrer">
                        <span>💬</span>
                        <span>WhatsApp</span>
                      </a>`
                    : ""
                }
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderDocModal() {
  const overlay = document.getElementById("docModalOverlay");
  const titleEl = document.getElementById("docModalTitle");
  const subtitleEl = document.getElementById("docModalSubtitle");
  const bodyEl = document.getElementById("docModalBody");
  if (!overlay || !titleEl || !subtitleEl || !bodyEl) return;

  overlay.classList.toggle("active", state.docModalOpen);
  if (!state.docModalOpen) return;

  const item = state.docModalItem;
  titleEl.textContent = item?.title || "Dokumen Tugas";
  subtitleEl.textContent = item
    ? `${item.courseCode} • ${item.classCode} — ${item.courseName}`
    : "";

  if (state.docModalError) {
    bodyEl.innerHTML = `
      <div class="status-bar" style="border-color: var(--danger); color: var(--danger);">
        <span>${escapeHtml(state.docModalError)}</span>
      </div>
    `;
    return;
  }

  if (!state.docModalList || state.docModalList.length === 0) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 28px 16px; color: var(--text-muted);">
        <div style="font-size: 2rem; margin-bottom: 8px;">📄</div>
        <p style="font-weight: 600; color: var(--text);">Tidak ada dokumen lampiran</p>
        <p style="font-size: 0.85rem; margin-top: 4px;">Tugas ini tidak memiliki file soal/lampiran untuk diunduh.</p>
      </div>
    `;
    return;
  }

  bodyEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 10px;">
      ${state.docModalList
        .map(
          (doc, idx) => `
          <div class="doc-item-card">
            <div style="min-width: 0;">
              <div style="font-weight: 700; color: var(--text); word-break: break-word;">
                ${escapeHtml(getDocFilename(doc))}
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted);">
                ${escapeHtml(doc.size ? `${doc.size} KB` : doc.type || "Dokumen")}
              </div>
            </div>
            <button type="button" class="btn-download-doc" data-doc-idx="${idx}">
              <span>📥</span>
              <span>Download</span>
            </button>
          </div>
        `,
        )
        .join("")}
    </div>
  `;
}

function renderAll() {
  const counts = getScheduleCounts();
  const compCounts = getScheduleCountByComp();
  renderHeaderAndStatus();
  renderPeriodsSelect();
  renderSummaryBadges(counts);
  renderFilterControls(counts, compCounts);
  renderCardsGrid();
  renderTeamModal();
  renderDocModal();
}

// ==========================================
// Event Listeners Setup (No inline handlers)
// ==========================================

function setupEventListeners() {
  // Detect display mode (popup vs sidepanel vs tab)
  const params = new URLSearchParams(window.location.search);
  const viewMode = params.get("view");
  if (viewMode === "sidepanel") {
    document.body.classList.remove("mode-popup", "mode-full");
    document.body.classList.add("mode-sidepanel");
    // Hide the "Open in Side Panel" button when already inside the side panel
    document.getElementById("openSidePanelBtn")?.classList.add("hidden");
  } else if (viewMode === "tab" || (viewMode !== "popup" && window.innerWidth > 680)) {
    document.body.classList.remove("mode-popup", "mode-sidepanel");
    document.body.classList.add("mode-full");
  } else {
    document.body.classList.remove("mode-full", "mode-sidepanel");
    document.body.classList.add("mode-popup");
  }

  // Period change
  document.getElementById("periodSelect")?.addEventListener("change", (e) => {
    state.schedulePeriod = e.target.value;
    savePreferences();
    loadScheduleAssessments(false);
  });

  // Refresh button
  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    loadScheduleAssessments(true);
  });

  // Search input
  document.getElementById("searchInput")?.addEventListener("input", (e) => {
    state.scheduleSearchQuery = e.target.value;
    renderCardsGrid();
  });

  // Re-login button
  document.getElementById("reloginBtn")?.addEventListener("click", () => {
    triggerRelogin();
  });

  // Open in Side Panel
  document.getElementById("openSidePanelBtn")?.addEventListener("click", async () => {
    if (globalThis.chrome?.sidePanel?.open && globalThis.chrome?.windows?.getCurrent) {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      window.close();
    } else {
      openExternalUrl(chrome.runtime.getURL("schedule.html?view=tab"));
    }
  });

  // Open in Full Tab
  document.getElementById("openFullTabBtn")?.addEventListener("click", () => {
    const url = globalThis.chrome?.runtime?.getURL
      ? chrome.runtime.getURL("schedule.html?view=tab")
      : window.location.href;
    openExternalUrl(url);
  });

  // Toggle settings panel
  document.getElementById("toggleSettingsBtn")?.addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    const input = document.getElementById("backendUrlInput");
    if (panel) {
      panel.classList.toggle("hidden");
      if (input) input.value = state.backendBaseUrl;
    }
  });

  // Save settings
  document.getElementById("saveSettingsBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("backendUrlInput");
    if (input && input.value.trim()) {
      state.backendBaseUrl = input.value.trim().replace(/\/+$/, "");
      await savePreferences();
      document.getElementById("settingsPanel")?.classList.add("hidden");
      await loadInitData();
    }
  });

  // Test notification button
  document.getElementById("testNotificationBtn")?.addEventListener("click", async () => {
    await notifyBackgroundSync(true);
  });

  // Summary badge clicks (quick filter to active reminder window or due today)
  document.getElementById("activeReminderCard")?.addEventListener("click", () => {
    state.scheduleAvailabilityFilter =
      state.scheduleAvailabilityFilter === "reminder_window"
        ? "open"
        : "reminder_window";
    savePreferences();
    renderAll();
  });

  document.getElementById("todayReminderCard")?.addEventListener("click", () => {
    state.scheduleAvailabilityFilter =
      state.scheduleAvailabilityFilter === "today" ? "open" : "today";
    savePreferences();
    renderAll();
  });

  // Category buttons (LEC / LAB)
  document.getElementById("btnCatLEC")?.addEventListener("click", () => {
    toggleScheduleCategory("LEC");
  });
  document.getElementById("btnCatLAB")?.addEventListener("click", () => {
    toggleScheduleCategory("LAB");
  });

  // Toggle Advanced Filters Drawer (Types & Subjects)
  document.getElementById("toggleAdvFiltersBtn")?.addEventListener("click", () => {
    state.advFiltersOpen = !state.advFiltersOpen;
    renderFilterControls(getScheduleCounts(), getScheduleCountByComp());
  });

  // Availability tabs
  document
    .getElementById("availabilityTabsContainer")
    ?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-avail]");
      if (!btn) return;
      state.scheduleAvailabilityFilter = btn.getAttribute("data-avail");
      savePreferences();
      renderAll();
    });

  // Select / clear all types & subjects
  document
    .getElementById("selectAllTypesBtn")
    ?.addEventListener("click", selectAllScheduleTypes);
  document
    .getElementById("clearAllTypesBtn")
    ?.addEventListener("click", clearAllScheduleTypes);
  document
    .getElementById("selectAllSubjectsBtn")
    ?.addEventListener("click", selectAllScheduleSubjects);
  document
    .getElementById("clearAllSubjectsBtn")
    ?.addEventListener("click", clearAllScheduleSubjects);

  // Types pills event delegation
  document
    .getElementById("typesPillsContainer")
    ?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-type-key]");
      if (!btn) return;
      toggleScheduleType(btn.getAttribute("data-type-key"));
    });

  // Subjects pills event delegation
  document
    .getElementById("subjectsPillsContainer")
    ?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-subject-key]");
      if (!btn) return;
      toggleScheduleSubject(btn.getAttribute("data-subject-key"));
    });

  // Reset filters
  document
    .getElementById("resetFiltersBtn")
    ?.addEventListener("click", resetScheduleFilters);
  document
    .getElementById("emptyResetFiltersBtn")
    ?.addEventListener("click", resetScheduleFilters);

  // Cards grid event delegation
  document.getElementById("cardsGrid")?.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("button[data-action]");
    if (actionBtn) {
      e.stopPropagation();
      const itemId = actionBtn.getAttribute("data-item-id");
      const item = state.scheduleAssessments.find((a) => a.id === itemId);
      if (!item) return;

      const action = actionBtn.getAttribute("data-action");
      if (action === "download-doc") {
        downloadAssessmentDoc(item);
      } else if (action === "view-team") {
        openTeamModal(item);
      }
      return;
    }

    const card = e.target.closest(".assessment-card[data-item-id]");
    if (card) {
      const itemId = card.getAttribute("data-item-id");
      const item = state.scheduleAssessments.find((a) => a.id === itemId);
      if (item) {
        openAssessmentInLms(item);
      }
    }
  });

  // Modals close & doc download delegation
  document
    .getElementById("closeTeamModalBtn")
    ?.addEventListener("click", closeTeamModal);
  document.getElementById("teamModalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "teamModalOverlay") closeTeamModal();
  });

  document
    .getElementById("closeDocModalBtn")
    ?.addEventListener("click", closeDocModal);
  document.getElementById("docModalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "docModalOverlay") closeDocModal();
  });
  document.getElementById("docModalBody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-doc-idx]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-doc-idx"));
    const doc = state.docModalList[idx];
    if (doc) triggerFileDownload(doc);
  });

  // Escape key closes modals
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.teamModalOpen) closeTeamModal();
      if (state.docModalOpen) closeDocModal();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await loadSavedPreferences();
  await loadInitData();
});
