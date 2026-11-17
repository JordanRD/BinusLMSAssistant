/**
 * Alpine.js component for Forum Page (/forum)
 */
document.addEventListener("alpine:init", () => {
  Alpine.data("forumApp", () => ({
    ...window.LmsCommon.createBaseAuth(),

    courses: [],
    selectedCourseIndex: "",
    currentClassId: "",
    subjectPlaceholder: "Select subject...",

    sessions: [],
    selectedSessionId: "",
    sessionPlaceholder: "Loading sessions...",

    threads: [],
    isLoadingPosts: false,
    unansweredOnly: false,
    fetchAbortController: null,

    // Thread answer forms state: map threadId -> { text, isSubmitting, feedbackText, feedbackClass }
    cardReplies: {},

    // Modal state
    isModalOpen: false,
    activeModalThreadId: null,
    modalThread: null,
    modalCurrentPage: 1,
    modalTotalComments: 0,
    modalCommentsList: [],
    modalIsLoading: false,
    modalReplyText: "",
    modalSubmitting: false,
    modalFeedbackText: "",
    modalFeedbackClass: "",
    currentUserId: "",
    modalErrorMessage: "",

    init() {
      this.loadInitData();
      this.$watch("isModalOpen", (val) => {
        document.body.style.overflow = val ? "hidden" : "";
      });
    },

    // Computed getters
    get filteredThreads() {
      return this.threads.filter((t) => {
        if (this.unansweredOnly && t.hasReplied) {
          return false;
        }
        return true;
      });
    },

    get countBarText() {
      if (!this.threads.length) return "";
      return `Showing ${this.filteredThreads.length} of ${this.threads.length} posts`;
    },

    get selectedCourse() {
      if (this.selectedCourseIndex === "" || !this.courses[this.selectedCourseIndex]) {
        return null;
      }
      return this.courses[this.selectedCourseIndex];
    },

    get selectedSession() {
      return this.sessions.find((s) => s.sessionId === this.selectedSessionId) || null;
    },

    get selectedSessionText() {
      const s = this.selectedSession;
      if (!s) return "";
      return `Session ${s.classSessionNumber}: ${s.topicName}`;
    },

    get emptyStateTitle() {
      if (this.unansweredOnly && this.threads.length > 0) {
        return "All questions in this session have already been answered!";
      }
      return "No lecturer posts found in this session.";
    },

    get emptyStateTip() {
      if (this.unansweredOnly && this.threads.length > 0) {
        return "Uncheck 'Show Unanswered Only' to review your answers.";
      }
      return "Try selecting another session from the Session Filter dropdown above.";
    },

    get modalSubtitle() {
      if (!this.modalThread) return "Memuat diskusi...";
      return `Session ${this.modalThread.sessionNumber || "-"}: ${this.modalThread.topicName || ""} • Dosen: ${this.modalThread.authorName || "Instructor"} (${this.modalThread.authorRole || ""})`;
    },

    get pinnedComment() {
      if (!this.modalCommentsList || !this.modalCommentsList.length || !this.currentUserId) {
        return null;
      }
      let found = null;
      const traverse = (list) => {
        if (!list || found) return;
        for (const item of list) {
          if (item.authorId === this.currentUserId) {
            found = item;
            return;
          }
          if (item.replies && Array.isArray(item.replies)) {
            traverse(item.replies);
          }
        }
      };
      traverse(this.modalCommentsList);
      return found;
    },

    get commentTreeHtml() {
      if (this.modalErrorMessage) {
        return `<div style="text-align:center; padding:20px; color:var(--danger);">${this.escapeHtml(this.modalErrorMessage)}</div>`;
      }
      if (!this.modalCommentsList || this.modalCommentsList.length === 0) {
        return `<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:0.9rem;">Belum ada jawaban dari mahasiswa lain pada pertanyaan ini.</div>`;
      }
      return this.modalCommentsList
        .map((c) => this.renderSingleCommentCard(c, this.currentUserId, false))
        .join("");
    },

    getReplyState(threadId) {
      if (!this.cardReplies[threadId]) {
        this.cardReplies[threadId] = {
          text: "",
          isSubmitting: false,
          feedbackText: "",
          feedbackClass: "",
        };
      }
      return this.cardReplies[threadId];
    },

    // Methods
    async loadInitData() {
      this.statusBarText = "⏳ Initializing session and loading academic periods...";
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
        const urlParams = new URLSearchParams(window.location.search);
        const targetPeriod = urlParams.get("period");
        const targetClassId = urlParams.get("class_id");
        const targetSessionId = urlParams.get("session_id");
        const targetSessionNumber = urlParams.get("session_number");
        const openDetail = urlParams.get("open_detail") === "1";

        this.selectedPeriod =
          targetPeriod || data.activePeriod || (this.periods[0] ? this.periods[0].code : "");
        this.courses = data.courses || [];

        if (targetPeriod && targetPeriod !== data.activePeriod) {
          const subjRes = await fetch(
            `/api/subjects?period=${encodeURIComponent(this.selectedPeriod)}`,
          );
          const subjData = await subjRes.json();
          this.courses = subjData.courses || [];
        }

        if (targetClassId) {
          let idx = this.courses.findIndex((c) => c.classId === targetClassId);
          if (idx === -1) {
            const labRes = await fetch(
              `/api/subjects?period=${encodeURIComponent(this.selectedPeriod)}&include_lab=true`,
            );
            const labData = await labRes.json();
            this.courses = labData.courses || this.courses;
            idx = this.courses.findIndex((c) => c.classId === targetClassId);
          }
          this.selectedCourseIndex = idx >= 0 ? idx : (this.courses.length > 0 ? 0 : "");
        } else {
          this.selectedCourseIndex = this.courses.length > 0 ? 0 : "";
        }

        this.statusBarText = "✅ Ready.";
        if (this.courses.length > 0) {
          await this.onSubjectChange({
            targetSessionId,
            targetSessionNumber,
            openDetail,
          });
        }
      } catch (err) {
        this.statusBarText = `❌ Network error initializing: ${err.message}`;
      } finally {
        this.isLoadingPeriods = false;
      }
    },

    async onPeriodChange() {
      if (!this.selectedPeriod) return;
      this.statusBarText = `⏳ Fetching subjects for period ${this.selectedPeriod}...`;
      this.courses = [];
      this.selectedCourseIndex = "";
      this.sessions = [];
      this.selectedSessionId = "";
      this.threads = [];
      try {
        const res = await fetch(`/api/subjects?period=${encodeURIComponent(this.selectedPeriod)}`);
        const data = await res.json();
        this.courses = data.courses || [];
        this.statusBarText = `✅ Loaded ${this.courses.length} subjects.`;
        if (this.courses.length > 0) {
          this.selectedCourseIndex = 0;
          await this.onSubjectChange();
        } else {
          this.subjectPlaceholder = `No subjects found for period ${this.selectedPeriod}`;
        }
      } catch (err) {
        this.statusBarText = `❌ Error loading subjects: ${err.message}`;
      }
    },

    async onSubjectChange(deepLinkOpts = null) {
      if (this.selectedCourseIndex === "" || !this.courses[this.selectedCourseIndex]) {
        this.statusBarText = "⚠️ Please select a subject first.";
        return;
      }

      const course = this.courses[this.selectedCourseIndex];
      this.currentClassId = course.classId;
      this.sessions = [];
      this.selectedSessionId = "";
      this.sessionPlaceholder = "Loading sessions...";
      this.statusBarText = `⏳ Loading sessions for ${course.courseName}...`;

      try {
        const res = await fetch(`/api/sessions?class_id=${encodeURIComponent(this.currentClassId)}`);
        const data = await res.json();

        if (data.error) {
          this.statusBarText = `❌ Error loading sessions: ${data.error}`;
          this.sessions = [{ sessionId: "ALL", classSessionNumber: 0, topicName: "All Sessions", isActive: false }];
          this.selectedSessionId = "ALL";
          return;
        }

        this.sessions = data.sessions || [];
        if (this.sessions.length === 0) {
          this.sessionPlaceholder = "No sessions available";
          return;
        }

        let matchedSession = null;
        if (deepLinkOpts?.targetSessionId) {
          matchedSession = this.sessions.find(
            (s) => s.sessionId === deepLinkOpts.targetSessionId,
          );
        }
        if (!matchedSession && deepLinkOpts?.targetSessionNumber) {
          matchedSession = this.sessions.find(
            (s) => String(s.classSessionNumber) === String(deepLinkOpts.targetSessionNumber),
          );
        }

        const activeSession = matchedSession || this.sessions.find((s) => s.isActive);
        if (activeSession) {
          this.selectedSessionId = activeSession.sessionId;
        } else if (data.activeSessionId) {
          this.selectedSessionId = data.activeSessionId;
        } else {
          this.selectedSessionId = this.sessions[this.sessions.length - 1].sessionId;
        }

        await this.fetchPosts();

        if (deepLinkOpts?.openDetail && this.threads.length > 0) {
          this.openCommentsModal(this.threads[0].threadId);
          window.history.replaceState({}, "", "/forum");
        }
      } catch (err) {
        this.statusBarText = `❌ Error loading sessions: ${err.message}`;
      }
    },

    onSessionChange() {
      this.fetchPosts();
    },

    async fetchPosts() {
      if (this.selectedCourseIndex === "" || !this.courses[this.selectedCourseIndex]) {
        this.statusBarText = "⚠️ Please select a subject first.";
        return;
      }

      const course = this.courses[this.selectedCourseIndex];
      this.currentClassId = course.classId;
      if (!this.selectedSessionId) {
        this.statusBarText = "⚠️ Please select a session.";
        return;
      }

      if (this.fetchAbortController) {
        this.fetchAbortController.abort();
      }
      this.fetchAbortController = new AbortController();

      this.isLoadingPosts = true;
      this.statusBarText = `⏳ Fetching posts for ${course.courseName} (${this.selectedSessionText})...`;

      try {
        const url = `/api/posts?class_id=${encodeURIComponent(this.currentClassId)}&session_id=${encodeURIComponent(this.selectedSessionId)}`;
        const res = await fetch(url, { signal: this.fetchAbortController.signal });
        const data = await res.json();

        if (data.error) {
          this.statusBarText = `❌ ${data.error}`;
          this.threads = [];
          return;
        }

        this.threads = data.threads || [];
        this.statusBarText = `✅ Loaded ${this.threads.length} lecturer posts for ${course.courseName}.`;
      } catch (err) {
        if (err.name === "AbortError") return;
        this.statusBarText = `❌ Network error fetching posts: ${err.message}`;
      } finally {
        this.isLoadingPosts = false;
      }
    },

    async submitAnswer(threadId) {
      const reply = this.getReplyState(threadId);
      const answerText = reply.text.trim();

      if (!answerText) {
        reply.feedbackClass = "submit-feedback error";
        reply.feedbackText = "⚠️ Answer cannot be empty.";
        return;
      }

      reply.isSubmitting = true;
      reply.feedbackClass = "submit-feedback";
      reply.feedbackText = "Submitting answer...";

      const threadObj = this.threads.find((x) => x.threadId === threadId);

      try {
        const res = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
            answer_text: answerText,
            class_id: this.currentClassId,
            session_id: threadObj ? threadObj.sessionId : null,
          }),
        });

        const data = await res.json();
        if (data.success) {
          reply.feedbackClass = "submit-feedback success";
          reply.feedbackText = "🎉 Answer posted successfully!";
          reply.text = "";

          if (threadObj) {
            threadObj.hasReplied = true;
            threadObj.replyText = answerText;
            threadObj.replyDate = new Date().toISOString();
          }
        } else {
          reply.feedbackClass = "submit-feedback error";
          reply.feedbackText = `❌ Failed: ${data.error}`;
        }
      } catch (err) {
        reply.feedbackClass = "submit-feedback error";
        reply.feedbackText = `❌ Error: ${err.message}`;
      } finally {
        reply.isSubmitting = false;
      }
    },

    // Modal functions
    openCommentsModal(threadId) {
      this.activeModalThreadId = threadId;
      this.modalThread = this.threads.find((x) => x.threadId === threadId) || null;
      this.modalCurrentPage = 1;
      this.modalCommentsList = [];
      this.modalTotalComments = 0;
      this.modalReplyText = "";
      this.modalFeedbackText = "";
      this.modalFeedbackClass = "";
      this.modalErrorMessage = "";
      this.isModalOpen = true;

      this.fetchModalComments(1, false);
    },

    closeCommentsModal() {
      this.isModalOpen = false;
      this.activeModalThreadId = null;
      this.modalThread = null;
    },

    async fetchModalComments(page = 1, append = false) {
      if (!this.activeModalThreadId || !this.currentClassId) return;
      if (this.modalIsLoading) return;

      this.modalIsLoading = true;
      this.modalErrorMessage = "";

      try {
        const url = `/api/comments?class_id=${encodeURIComponent(this.currentClassId)}&thread_id=${encodeURIComponent(this.activeModalThreadId)}&page=${page}&limit=25`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
          this.modalErrorMessage = `Gagal memuat jawaban: ${data.error}`;
          return;
        }

        if (data.currentUserId) {
          this.currentUserId = data.currentUserId;
        }

        this.modalTotalComments = data.total || 0;
        const newComments = data.comments || [];

        if (append) {
          this.modalCommentsList = this.modalCommentsList.concat(newComments);
        } else {
          this.modalCommentsList = newComments;
        }
      } catch (err) {
        this.modalErrorMessage = `Network error: ${err.message}`;
      } finally {
        this.modalIsLoading = false;
      }
    },

    loadMoreModalComments() {
      if (this.modalIsLoading) return;
      this.modalCurrentPage += 1;
      this.fetchModalComments(this.modalCurrentPage, true);
    },

    async submitModalAnswer() {
      const answerText = this.modalReplyText.trim();
      if (!answerText) {
        this.modalFeedbackClass = "submit-feedback error";
        this.modalFeedbackText = "⚠️ Jawaban tidak boleh kosong.";
        return;
      }

      this.modalSubmitting = true;
      this.modalFeedbackClass = "submit-feedback";
      this.modalFeedbackText = "Mengirim jawaban...";

      const threadObj = this.threads.find((x) => x.threadId === this.activeModalThreadId);

      try {
        const res = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: this.activeModalThreadId,
            answer_text: answerText,
            class_id: this.currentClassId,
            session_id: threadObj ? threadObj.sessionId : null,
          }),
        });

        const data = await res.json();
        if (data.success) {
          this.modalFeedbackClass = "submit-feedback success";
          this.modalFeedbackText = "🎉 Jawaban berhasil dikirim!";
          this.modalReplyText = "";

          if (threadObj) {
            threadObj.hasReplied = true;
            threadObj.replyText = answerText;
            threadObj.replyDate = new Date().toISOString();
          }

          setTimeout(() => {
            this.fetchModalComments(1, false);
          }, 600);
        } else {
          this.modalFeedbackClass = "submit-feedback error";
          this.modalFeedbackText = `❌ Gagal: ${data.error}`;
        }
      } catch (err) {
        this.modalFeedbackClass = "submit-feedback error";
        this.modalFeedbackText = `❌ Error: ${err.message}`;
      } finally {
        this.modalSubmitting = false;
      }
    },

    renderSingleCommentCard(c, currentUserId, isNested = false) {
      const isMe = currentUserId && c.authorId === currentUserId;
      const isInstructor = (c.authorRole || "")
        .toLowerCase()
        .includes("instructor");
      const authorName = c.authorfullName || c.authorFullName || "Mahasiswa";
      const roleName = c.authorRole || "Member";
      const postDate = this.formatDisplayDate(c.postDate);
      const initials = this.getInitials(authorName);

      const meBadge = isMe
        ? `<span class="badge badge-replied" style="font-size:0.7rem; padding:2px 7px;">⭐ Jawaban Anda</span>`
        : "";
      const roleBadge = isInstructor
        ? `<span class="badge badge-lecturer" style="font-size:0.7rem; padding:2px 7px;">👨‍🏫 ${this.escapeHtml(roleName)}</span>`
        : "";
      const avatarClass = isMe ? "is-me" : isInstructor ? "is-instructor" : "";

      let repliesHtml = "";
      if (c.replies && Array.isArray(c.replies) && c.replies.length > 0) {
        repliesHtml = `
          <div class="replies-nested-list">
            ${c.replies.map((r) => this.renderSingleCommentCard(r, currentUserId, true)).join("")}
          </div>
        `;
      }

      return `
        <div class="comment-card ${isMe ? "is-me" : ""}">
          <div class="comment-meta">
            <div class="comment-author-left">
              <div class="avatar-circle ${avatarClass}">
                ${c.authorPictureUrl ? `<img src="${c.authorPictureUrl}" style="width:3rem;height:3rem;object-fit:cover;" alt="${initials}">` : initials}
              </div>
              <div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span class="author-name-text">${this.escapeHtml(authorName)}</span>
                  ${meBadge}
                  ${roleBadge}
                </div>
                <div class="comment-date">${postDate}</div>
              </div>
            </div>
          </div>
          <div class="comment-text-body">
            ${this.renderCommentBody(c.commentText)}
          </div>
          ${repliesHtml}
        </div>
      `;
    },

    renderCommentBody(rawHtml) {
      if (!rawHtml) return "<p><em>(Tidak ada teks jawaban)</em></p>";
      let safe = rawHtml.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        "",
      );
      safe = safe.replace(
        /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
        "",
      );
      safe = safe.replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
      return safe;
    },

    formatDisplayDate(dateStr) {
      return window.LmsCommon.formatDisplayDate(dateStr);
    },

    getInitials(name) {
      return window.LmsCommon.getInitials(name);
    },

    escapeHtml(str) {
      return window.LmsCommon.escapeHtml(str);
    },
  }));
});
