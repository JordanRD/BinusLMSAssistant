/**
 * Background Service Worker for BINUS LMS Schedule & Assessments Extension
 * - Removes Monday-to-Monday logic
 * - Active task reminder window:
 *   - Attendance: only on its deadline day (00:00:00 – 23:59:59 of dueDate)
 *   - Other task types: from max(dueDate - 7 days, dateStart) until dueDate
 * - Updates extension toolbar badge & desktop notification based on this reminder logic
 */

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const ALARM_NAME = "binus-lms-schedule-sync";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isTaskCompleted(item) {
  return (
    item.status === "Completed" ||
    (item.totalAttempted !== null &&
      item.totalAttempted !== undefined &&
      Number(item.totalAttempted) > 0)
  );
}

function parseValidDate(isoStr) {
  if (!isoStr || typeof isoStr !== "string" || isoStr.startsWith("0001")) {
    return null;
  }
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : d;
}

function isAttendanceTask(item) {
  const lam = (item.lamType || "").toUpperCase();
  const act = (item.activityName || "").toLowerCase();
  return lam === "ATT" || act.includes("attendance") || act.includes("presensi");
}

function getTodayBounds(now = new Date()) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);

  const yyyy = startToday.getFullYear();
  const mm = String(startToday.getMonth() + 1).padStart(2, "0");
  const dd = String(startToday.getDate()).padStart(2, "0");

  return {
    startToday,
    endToday,
    dateKey: `${yyyy}-${mm}-${dd}`,
  };
}

/**
 * Returns the reminder active window { windowStart, windowEnd } for an undone task:
 * - For Attendance: 00:00:00.000 to 23:59:59.999 on the deadline (dueDate) day
 * - For Other tasks: max(dueDate - 7 days, dateStart) to dueDate
 */
function getTaskReminderWindow(item) {
  const due = parseValidDate(item.dueDate);
  if (!due) return null;

  if (isAttendanceTask(item)) {
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

/**
 * Update badge and trigger notification when today has active tasks to do.
 */
async function evaluateAndApplyScheduleState(assessments, options = {}) {
  const { forceNotify = false } = options;
  const now = new Date();

  const activeTasks = (assessments || []).filter((item) =>
    isTaskInActiveReminderWindow(item, now),
  );
  const dueTodayTasks = (assessments || []).filter((item) =>
    isTaskDueToday(item, now),
  );

  const activeCount = activeTasks.length;
  const dueTodayCount = dueTodayTasks.length;

  // 1. Update extension icon badge with number of active undone tasks in reminder window
  const badgeText = activeCount > 0 ? String(activeCount) : "";
  await chrome.action.setBadgeText({ text: badgeText });

  // Badge color: Red if any task is due today, Orange if active tasks exist, Blue otherwise
  const badgeColor =
    dueTodayCount > 0
      ? "#dc2626"
      : activeCount > 0
        ? "#ea580c"
        : "#2563eb";
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor });

  // Update tooltip title
  const titleParts = ["BINUS LMS Schedule"];
  titleParts.push(`🔔 Tugas Aktif / Perlu Dikerjakan: ${activeCount} tugas`);
  if (dueTodayCount > 0) {
    titleParts.push(`⚠️ Deadline Hari Ini: ${dueTodayCount} tugas`);
  }
  await chrome.action.setTitle({ title: titleParts.join("\n") });

  // Save summary to storage
  const { dateKey } = getTodayBounds(now);
  await chrome.storage.local.set({
    lastScheduleSummary: {
      updatedAt: now.toISOString(),
      activeTaskCount: activeCount,
      dueTodayCount: dueTodayCount,
    },
  });

  // 2. Notification reminder when today has an existing task to do
  if (activeCount > 0) {
    const stored = await chrome.storage.local.get([
      "lastNotifiedDateKey",
      "lastNotifiedTaskCount",
    ]);
    const shouldNotify =
      forceNotify ||
      stored.lastNotifiedDateKey !== dateKey ||
      (stored.lastNotifiedTaskCount || 0) < activeCount;

    if (shouldNotify) {
      const prioritized = dueTodayTasks.length > 0 ? dueTodayTasks : activeTasks;
      const topLines = prioritized.slice(0, 3).map((t) => {
        const course = t.courseName || t.courseCode || "Course";
        return `• [${t.component || "LEC"}] ${course}: ${t.title}`;
      });
      if (prioritized.length > 3) {
        topLines.push(`...dan ${prioritized.length - 3} tugas lainnya.`);
      }

      const headerLine =
        dueTodayCount > 0
          ? `⚠️ ${dueTodayCount} tugas jatuh tempo HARI INI! (${activeCount} tugas perlu dikerjakan)`
          : `📌 Ada ${activeCount} tugas yang perlu dikerjakan hari ini.`;

      await chrome.notifications.create(`binus-lms-today-${dateKey}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: "🔔 Pengingat Tugas BINUS LMS Hari Ini",
        message: `${headerLine}\n${topLines.join("\n")}`,
        priority: 2,
      });

      await chrome.storage.local.set({
        lastNotifiedDateKey: dateKey,
        lastNotifiedTaskCount: activeCount,
      });
    }
  }

  return {
    activeCount,
    dueTodayCount,
  };
}

/**
 * Fetch assessments from existing backend and update badge/notifications.
 */
async function syncFromBackend(options = {}) {
  try {
    const stored = await chrome.storage.local.get(["backendBaseUrl", "schedulePeriod"]);
    const baseUrl = (stored.backendBaseUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
    const periodParam = stored.schedulePeriod
      ? `?period=${encodeURIComponent(stored.schedulePeriod)}`
      : "";

    const res = await fetch(`${baseUrl}/api/schedule/assessments${periodParam}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !Array.isArray(data.assessments)) return null;

    await chrome.storage.local.set({
      cachedAssessments: data.assessments,
      cachedSubjects: data.subjects || [],
      cachedPeriod: data.period || stored.schedulePeriod || "",
    });

    return await evaluateAndApplyScheduleState(data.assessments, options);
  } catch (err) {
    console.warn("Background schedule sync warning:", err.message);
    return null;
  }
}

// Setup periodic alarm on install and startup
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 15 });
  await syncFromBackend({ forceNotify: false });
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 15 });
  await syncFromBackend({ forceNotify: false });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await syncFromBackend({ forceNotify: false });
  }
});

// Open full schedule page when notification is clicked
chrome.notifications.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("schedule.html?view=tab") });
});

// Listen for messages from popup / side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "SYNC_ASSESSMENTS_STATE") {
      const result = await evaluateAndApplyScheduleState(message.assessments || [], {
        forceNotify: Boolean(message.forceNotify),
      });
      sendResponse({ ok: true, ...result });
      return;
    }
    if (message?.type === "TRIGGER_BACKEND_SYNC") {
      const result = await syncFromBackend({
        forceNotify: Boolean(message.forceNotify),
      });
      sendResponse({ ok: Boolean(result), ...(result || {}) });
      return;
    }
    sendResponse({ ok: false });
  })();
  return true;
});
