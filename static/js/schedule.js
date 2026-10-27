/**
 * Alpine.js component for Schedule Page (/schedule)
 */
document.addEventListener("alpine:init", () => {
  Alpine.data("scheduleApp", () => ({
    ...window.LmsCommon.createBaseAuth(),

    schedulePeriod: "",
    scheduleLoading: false,
    scheduleLoaded: false,
    scheduleError: null,
    scheduleAssessments: [],
    scheduleSubjects: [],
    scheduleCategories: ["LEC", "LAB"],
    scheduleSelectedSubjects: [],
    scheduleSelectedTypes: [
      "personal_assignment",
      "team_assignment",
      "quiz",
      "project_team",
      "forum_discussion",
      "attendance",
      "other",
    ],
    scheduleAvailabilityFilter: "open",
    scheduleSearchQuery: "",

    init() {
      this.loadInitData();
    },

    async loadInitData() {
      this.statusBarText = "⏳ Initializing session and periods...";
      this.isLoadingPeriods = true;
      try {
        const res = await fetch("/api/init");
        const data = await res.json();

        if (data.error) {
          this.statusBarText = `⚠️ ${data.error}`;
          this.authError = "Not authenticated";
          return;
        }

        this.authError = null;
        this.user = data.user;
        this.periods = data.periods || [];
        this.selectedPeriod = data.activePeriod || (this.periods[0] ? this.periods[0].code : "");
        this.schedulePeriod = this.selectedPeriod;

        this.statusBarText = "✅ Ready.";
        await this.loadScheduleAssessments();
      } catch (err) {
        this.statusBarText = `❌ Network error initializing: ${err.message}`;
      } finally {
        this.isLoadingPeriods = false;
      }
    },

    // Schedule Getters
    get scheduleCounts() {
      const now = new Date();
      let open = 0,
        upcoming = 0,
        completed = 0,
        overdue = 0;
      this.scheduleAssessments.forEach((item) => {
        const st = this.getCardAvailability(item, now);
        if (st.key === "completed") completed++;
        else if (st.key === "upcoming") upcoming++;
        else if (st.key === "overdue") overdue++;
        else open++;
      });
      return {
        total: this.scheduleAssessments.length,
        open,
        upcoming,
        completed,
        overdue,
      };
    },

    get scheduleCountByComp() {
      let lec = 0,
        lab = 0;
      this.scheduleAssessments.forEach((item) => {
        if (item.component === "LEC") lec++;
        else if (item.component === "LAB") lab++;
      });
      return { LEC: lec, LAB: lab };
    },

    get availableScheduleTypes() {
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

      this.scheduleAssessments.forEach((item) => {
        const grp = this.getGroupedType(item);
        if (groups[grp.key]) {
          groups[grp.key].count++;
        } else {
          groups.other.count++;
        }
      });

      return Object.values(groups).filter((g) => g.count > 0);
    },

    get visibleScheduleSubjects() {
      const list = [];
      this.scheduleSubjects.forEach((sub) => {
        if (this.scheduleCategories.includes(sub.component)) {
          const key = `${sub.classId}_${sub.component}`;
          const count = this.scheduleAssessments.filter(
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
    },

    get isScheduleFiltered() {
      const allTypesCount = this.availableScheduleTypes.length;
      return (
        this.scheduleCategories.length < 2 ||
        this.scheduleAvailabilityFilter !== "open" ||
        (this.scheduleSearchQuery && this.scheduleSearchQuery.trim() !== "") ||
        this.scheduleSelectedSubjects.length < this.scheduleSubjects.length ||
        this.scheduleSelectedTypes.length < allTypesCount
      );
    },

    get filteredAssessments() {
      const now = new Date();
      const query = (this.scheduleSearchQuery || "").trim().toLowerCase();

      return this.scheduleAssessments.filter((item) => {
        // 1. Component filter (LEC/LAB)
        if (!this.scheduleCategories.includes(item.component)) return false;

        // 2. Subject filter
        const subjKey = `${item.classId}_${item.component}`;
        if (
          this.scheduleSelectedSubjects.length > 0 &&
          !this.scheduleSelectedSubjects.includes(subjKey)
        ) {
          return false;
        }

        // 3. Assessment grouped type filter
        const grp = this.getGroupedType(item);
        if (!this.scheduleSelectedTypes.includes(grp.key)) return false;

        // 4. Availability / status filter
        const avail = this.getCardAvailability(item, now);
        if (
          this.scheduleAvailabilityFilter === "open" &&
          avail.key !== "open" &&
          avail.key !== "urgent"
        )
          return false;
        if (this.scheduleAvailabilityFilter === "upcoming" && avail.key !== "upcoming")
          return false;
        if (this.scheduleAvailabilityFilter === "completed" && avail.key !== "completed")
          return false;
        if (this.scheduleAvailabilityFilter === "overdue" && avail.key !== "overdue")
          return false;

        // 5. Search query
        if (query) {
          const targetText = `${item.title} ${item.courseName} ${item.courseCode} ${item.activityName}`.toLowerCase();
          if (!targetText.includes(query)) return false;
        }

        return true;
      });
    },

    // Methods
    getCardAvailability(item, now = new Date()) {
      const isCompleted =
        item.status === "Completed" || (item.totalAttempted && item.totalAttempted > 0);
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

      const start = item.dateStart ? new Date(item.dateStart) : null;
      const due = item.dueDate ? new Date(item.dueDate) : null;

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
    },

    formatScheduleDate(isoStr) {
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
    },

    formatRelativeDate(item) {
      const now = new Date();
      const isCompleted =
        item.status === "Completed" || (item.totalAttempted && item.totalAttempted > 0);
      if (isCompleted) {
        if (item.submissionDate) {
          return `Diserahkan pada ${this.formatScheduleDate(item.submissionDate)}`;
        }
        return "Tugas telah diselesaikan";
      }

      const start = item.dateStart ? new Date(item.dateStart) : null;
      const due = item.dueDate ? new Date(item.dueDate) : null;

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
    },

    getGroupedType(item) {
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
    },

    getTypeLabel(item) {
      return this.getGroupedType(item).label;
    },

    async loadScheduleAssessments(forceRefresh = false) {
      if (!this.schedulePeriod) {
        this.schedulePeriod =
          this.selectedPeriod || (this.periods[0] ? this.periods[0].code : "2611");
      }
      this.scheduleLoading = true;
      this.scheduleError = null;
      try {
        const url = `/api/schedule/assessments?period=${this.schedulePeriod}${
          forceRefresh ? "&force_refresh=true" : ""
        }`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) {
          this.scheduleError = data.error;
          return;
        }
        this.scheduleAssessments = data.assessments || [];
        this.scheduleSubjects = data.subjects || [];

        // Initialize selected subjects (all checked by default)
        this.scheduleSelectedSubjects = this.scheduleSubjects.map(
          (s) => `${s.classId}_${s.component}`,
        );
        this.scheduleLoaded = true;
      } catch (err) {
        this.scheduleError = `Gagal memuat jadwal: ${err.message}`;
      } finally {
        this.scheduleLoading = false;
      }
    },

    toggleScheduleCategory(cat) {
      if (this.scheduleCategories.includes(cat)) {
        if (this.scheduleCategories.length > 1) {
          this.scheduleCategories = this.scheduleCategories.filter((c) => c !== cat);
        }
      } else {
        this.scheduleCategories.push(cat);
      }
    },

    toggleScheduleType(typeKey) {
      if (this.scheduleSelectedTypes.includes(typeKey)) {
        if (this.scheduleSelectedTypes.length > 1) {
          this.scheduleSelectedTypes = this.scheduleSelectedTypes.filter(
            (t) => t !== typeKey,
          );
        }
      } else {
        this.scheduleSelectedTypes.push(typeKey);
      }
    },

    toggleScheduleSubject(subKey) {
      if (this.scheduleSelectedSubjects.includes(subKey)) {
        if (this.scheduleSelectedSubjects.length > 1) {
          this.scheduleSelectedSubjects = this.scheduleSelectedSubjects.filter(
            (k) => k !== subKey,
          );
        }
      } else {
        this.scheduleSelectedSubjects.push(subKey);
      }
    },

    selectAllScheduleTypes() {
      this.scheduleSelectedTypes = [
        "personal_assignment",
        "team_assignment",
        "quiz",
        "project_team",
        "forum_discussion",
        "attendance",
        "other",
      ];
    },

    clearAllScheduleTypes() {
      this.scheduleSelectedTypes = [];
    },

    selectAllScheduleSubjects() {
      this.scheduleSelectedSubjects = this.scheduleSubjects.map(
        (s) => `${s.classId}_${s.component}`,
      );
    },

    clearAllScheduleSubjects() {
      this.scheduleSelectedSubjects = [];
    },

    resetScheduleFilters() {
      this.scheduleCategories = ["LEC", "LAB"];
      this.scheduleAvailabilityFilter = "open";
      this.scheduleSearchQuery = "";
      this.selectAllScheduleTypes();
      this.selectAllScheduleSubjects();
    },

    openAssessmentInLms(item) {
      if (item.deepLink) {
        window.open(item.deepLink, "_blank");
      }
    },

    escapeHtml(str) {
      return window.LmsCommon.escapeHtml(str);
    },
  }));
});
