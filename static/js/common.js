/**
 * Common utilities and authentication state for BINUS LMS Forum Assistant
 */

window.LmsCommon = {
  escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  formatDisplayDate(dateStr) {
    if (!dateStr) return "-";
    try {
      const clean = dateStr.replace("Z", "");
      const d = new Date(clean);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return dateStr;
    }
  },

  getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  },

  createBaseAuth() {
    return {
      user: null,
      authError: null,
      isRelogging: false,
      statusBarText: "Ready.",
      periods: [],
      selectedPeriod: "",
      isLoadingPeriods: false,

      async triggerRelogin(onSuccess) {
        this.isRelogging = true;
        this.statusBarText = "🌐 Chrome opened. Please log in to Binus LMS in the browser window...";
        try {
          const res = await fetch("/api/relogin", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            this.statusBarText = `🎉 Login successful for ${data.name}!`;
            if (typeof onSuccess === "function") {
              await onSuccess();
            } else if (typeof this.loadInitData === "function") {
              await this.loadInitData();
            }
          } else {
            this.statusBarText = `❌ Login failed: ${data.error}`;
          }
        } catch (err) {
          this.statusBarText = `❌ Error: ${err.message}`;
        } finally {
          this.isRelogging = false;
        }
      },
    };
  },
};
