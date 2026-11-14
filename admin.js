/**
 * KITS LMS — Administrator Portal & Assessment Console
 * Streamlined 4-Module Production Architecture:
 * 1. Course Management (Create/Edit/Publish, Question & Coding PDF Assessments)
 * 2. Students List (Roll Number Primary Unique Identifier, Branch/Batch Filters, Excel Export)
 * 3. Exam Results (Exam-wise Student List, Strict Exam Isolation, Pass/Fail, Excel Export)
 * 4. Excel Downloads (One-click SheetJS .xlsx generation for Students and Exam Results)
 */

(function () {
    "use strict";

    const CONFIG = window.MOCKTEST_ADMIN_CONFIG || {
        sessionKey: "kits_lms_admin_session",
        verifyEndpoint: "/api/auth/verify-session"
    };

    const $ = selector => document.querySelector(selector);
    const $$ = selector => Array.from(document.querySelectorAll(selector));

    // Escape HTML to prevent XSS
    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatDate(val) {
        if (!val) return "N/A";
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    }

    function formatDateTime(val) {
        if (!val) return "—";
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        try {
            return d.toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true
            }) + " IST";
        } catch (e) {
            return d.toLocaleString() + " IST";
        }
    }

    function sanitizeFileName(name) {
        return (name || "Export").replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/__+/g, "_");
    }

    function matchesAcademicYear(actualYear, filterYear) {
        if (!filterYear) return true;
        const actual = String(actualYear || "").toLowerCase().trim();
        const filter = String(filterYear || "").toLowerCase().trim();
        if (!filter) return true;
        if (actual === filter) return true;

        if (filter.includes("1st") || filter.startsWith("1") || filter.includes("first")) {
            return actual.includes("1st") || actual.includes("first") || actual.startsWith("1");
        }
        if (filter.includes("2nd") || filter.startsWith("2") || filter.includes("second")) {
            return actual.includes("2nd") || actual.includes("second") || actual.startsWith("2nd");
        }
        if (filter.includes("3rd") || filter.startsWith("3") || filter.includes("third")) {
            return actual.includes("3rd") || actual.includes("third") || actual.startsWith("3rd");
        }
        if (filter.includes("4th") || filter.startsWith("4") || filter.includes("fourth")) {
            return actual.includes("4th") || actual.includes("fourth") || actual.startsWith("4th");
        }
        return actual.includes(filter);
    }

    // Toast notification
    let toastTimeout = null;
    function showToast(message, isError = false) {
        const toast = $("#toast");
        if (!toast) return;
        toast.textContent = message;
        toast.style.background = isError ? "#dc2626" : "#1e293b";
        toast.classList.add("visible");
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3200);
    }

    function setModal(modal, open) {
        if (!modal) return;
        modal.classList.toggle("hidden", !open);
        document.body.style.overflow = open ? "hidden" : "";
    }

    // Close modals on [data-close-modal] click
    document.addEventListener("click", e => {
        const closeBtn = e.target.closest("[data-close-modal]");
        if (closeBtn) {
            const modal = closeBtn.closest(".modal-backdrop");
            if (modal) setModal(modal, false);
        }
    });

    // =========================================================================
    // 1. AUTHENTICATION & SESSION VERIFICATION
    // =========================================================================
    function getApiBase() {
        if (window.KITS_API_BASE) return window.KITS_API_BASE;
        const loc = window.location;
        if (!loc || !loc.hostname) return "http://localhost:3000";
        if (loc.port === "3000") return "";
        if (loc.protocol === "file:") return "http://localhost:3000";
        if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
            return `http://${loc.hostname}:3000`;
        }
        return "";
    }

    function getAdminSession() {
        const raw = localStorage.getItem(CONFIG.sessionKey) ||
                    sessionStorage.getItem(CONFIG.sessionKey) ||
                    localStorage.getItem("kits_lms_admin_session") ||
                    sessionStorage.getItem("kits_lms_admin_session");
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    const adminSession = getAdminSession();
    if(!adminSession || !adminSession.token || adminSession.role !== "admin"){
        window.location.replace("admin-login.html");
        return;
    }

    const adminToken = adminSession.token;

    let isVerifyingSession = false;
    let sessionVerified = false;

    function showOfflineState(message) {
        const overlay = $("#authGuardOverlay");
        const msgEl = $("#authGuardMessage");
        const actionEl = $("#authGuardAction");

        if (overlay) overlay.style.display = "flex";
        if (msgEl) msgEl.textContent = message;
        if (actionEl) {
            actionEl.style.display = "flex";
            actionEl.style.gap = "12px";
            actionEl.innerHTML = `
                <button id="retrySessionBtn" class="button-primary btn-sm" style="padding:8px 16px; font-weight:700; cursor:pointer; background:linear-gradient(135deg, #d4af37, #b8860b); color:#1a1a1a; border:none; border-radius:6px;">Retry Connection</button>
                <button id="authBackToLoginBtn" class="button-secondary btn-sm" style="padding:8px 16px; font-weight:600; cursor:pointer; background:#e2e8f0; color:#1e293b; border:none; border-radius:6px;">Back to Login</button>
            `;
            const retryBtn = $("#retrySessionBtn");
            if (retryBtn) retryBtn.addEventListener("click", () => verifyAdminSessionAndStart());
            const loginBtn = $("#authBackToLoginBtn");
            if (loginBtn) loginBtn.addEventListener("click", () => {
                window.location.href = "admin-login.html?reauth=1";
            });
        }
    }

    // Robust resilient fetch helper that handles 127.0.0.1 vs localhost loopback differences
    async function adminFetch(endpoint, options = {}) {
        const base = getApiBase();
        const primaryUrl = `${base}${endpoint}`;
        const headers = {
            ...(options.headers || {}),
            "Authorization": "Bearer " + adminToken
        };
        const fetchOpts = {
            ...options,
            headers,
            credentials: "include"
        };

        try {
            return await fetch(primaryUrl, fetchOpts);
        } catch (primaryErr) {
            if (primaryUrl.includes("127.0.0.1:3000")) {
                try {
                    return await fetch(primaryUrl.replace("127.0.0.1:3000", "localhost:3000"), fetchOpts);
                } catch (e2) {}
            } else if (primaryUrl.includes("localhost:3000")) {
                try {
                    return await fetch(primaryUrl.replace("localhost:3000", "127.0.0.1:3000"), fetchOpts);
                } catch (e2) {}
            }
            if (!primaryUrl.startsWith("/") && !endpoint.startsWith("http")) {
                try {
                    return await fetch(endpoint, fetchOpts);
                } catch (e3) {}
            }
            throw primaryErr;
        }
    }

    async function verifyAdminSessionAndStart() {
        if (isVerifyingSession) return;
        isVerifyingSession = true;

        const overlay = $("#authGuardOverlay");
        const msgEl = $("#authGuardMessage");
        const actionEl = $("#authGuardAction");

        if (overlay) overlay.style.display = "flex";
        if (msgEl) msgEl.textContent = "Verifying Administrator Session with server...";
        if (actionEl) actionEl.style.display = "none";

        try {
            const verifyPath = CONFIG.verifyEndpoint || "/api/auth/verify-session";
            const res = await adminFetch(verifyPath, { method: "GET" });

            if (res.ok) {
                const data = await res.json();
                if (data && data.valid && data.user && data.user.role === "admin") {
                    sessionVerified = true;
                    isVerifyingSession = false;

                    try {
                        const merged = { ...adminSession, user: data.user, role: "admin" };
                        localStorage.setItem(CONFIG.sessionKey, JSON.stringify(merged));
                        sessionStorage.setItem(CONFIG.sessionKey, JSON.stringify(merged));
                        localStorage.setItem("kits_lms_admin_session", JSON.stringify(merged));
                        sessionStorage.setItem("kits_lms_admin_session", JSON.stringify(merged));
                    } catch (e) {}

                    if ($("#adminProfileName")) $("#adminProfileName").textContent = (data.user && data.user.name) || adminSession.name || "IT Administrator";
                    if ($("#adminProfileEmail")) $("#adminProfileEmail").textContent = (data.user && data.user.email) || adminSession.email || "it.admin@kits.edu";

                    if (overlay) {
                        overlay.style.opacity = "0";
                        overlay.style.transition = "opacity 0.25s ease";
                        setTimeout(() => {
                            overlay.style.display = "none";
                        }, 250);
                    }

                    switchView("dashboard");
                    return;
                }
            }

            if (res.status === 401 || res.status === 403) {
                console.warn("[ADMIN-AUTH] Server rejected session token:", res.status);
                localStorage.removeItem(CONFIG.sessionKey);
                sessionStorage.removeItem(CONFIG.sessionKey);
                localStorage.removeItem("kits_lms_admin_session");
                sessionStorage.removeItem("kits_lms_admin_session");
                localStorage.removeItem("mocktest_admin_session");

                if (msgEl) msgEl.textContent = "Administrative session expired. Redirecting to login...";
                setTimeout(() => {
                    window.location.replace("admin-login.html?reauth=1");
                }, 600);
                return;
            }

            showOfflineState(`The server responded with status ${res.status} during session verification.`);
        } catch (networkErr) {
            console.warn("[ADMIN-AUTH] Network error during session verification:", networkErr);
            showOfflineState(`Unable to connect to KITS LMS Backend Server at ${getApiBase() || "http://localhost:3000"}. Please ensure 'node server.js' is active.`);
        } finally {
            isVerifyingSession = false;
        }
    }

    // Logout handling
    const logoutBtn = $("#logoutButton");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            try {
                await adminFetch("/api/auth/admin-logout", { method: "POST" });
            } catch (e) {}
            localStorage.removeItem(CONFIG.sessionKey);
            sessionStorage.removeItem(CONFIG.sessionKey);
            localStorage.removeItem("kits_lms_admin_session");
            sessionStorage.removeItem("kits_lms_admin_session");
            localStorage.removeItem("mocktest_admin_session");
            window.location.replace("admin-login.html?logged_out=1");
        });
    }

    // Set Administrator Profile in header
    if ($("#adminProfileName")) $("#adminProfileName").textContent = adminSession.name || "IT Administrator";
    if ($("#adminProfileEmail")) $("#adminProfileEmail").textContent = adminSession.email || "it.admin@kits.edu";

    // =========================================================================
    // 2. SHEETJS PRODUCTION EXCEL (.XLSX) EXPORT ENGINE
    // =========================================================================
    function exportToExcel(records, fileName, sheetName = "Sheet1") {
        if (typeof XLSX === "undefined") {
            alert("SheetJS library is loading. Please try again in a moment.");
            return;
        }
        if (!records || records.length === 0) {
            showToast("No data available to export.", true);
            return;
        }

        const ws = XLSX.utils.json_to_sheet(records);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);

        // Auto-fit column widths
        const colKeys = Object.keys(records[0] || {});
        const colWidths = colKeys.map(key => {
            let maxLen = key.length;
            records.forEach(row => {
                const val = row[key] !== null && row[key] !== undefined ? String(row[key]) : "";
                if (val.length > maxLen) maxLen = val.length;
            });
            return { wch: Math.min(Math.max(maxLen + 4, 12), 48) };
        });
        ws["!cols"] = colWidths;

        XLSX.writeFile(wb, fileName);
        showToast(`Exported ${fileName} successfully!`);
    }

    function exportStudentsRoster(studentsList) {
        // Strictly Active students only - suspended and deleted excluded
        const activeStudents = (studentsList || []).filter(s => (s.status || "active").toLowerCase() === "active");
        if (activeStudents.length === 0) {
            showToast("No active students available to export.", true);
            return;
        }

        const rows = activeStudents.map((s, idx) => ({
            "S.No.": idx + 1,
            "Roll Number": String(s.roll_number || s.rollNumber || "").toUpperCase().trim(),
            "Student Name": String(s.name || s.fullName || "").trim(),
            "College Email": String(s.email || "").trim(),
            "Branch": s.department || s.branch || "Information Technology",
            "Academic Year": s.academic_year || s.academicYear || "2nd Year B.Tech (2026-27)",
            "Batch": s.batch || "2026-27",
            "Registration Date": formatDate(s.created_at),
            "Account Status": "Active"
        }));
        exportToExcel(rows, "KITS_LMS_Active_Students.xlsx", "Active Students");
    }

    function exportExamResultsRoster(examTitle, candidateRoster, attemptedOnly = false) {
        let list = candidateRoster || [];
        if (attemptedOnly) {
            list = list.filter(r => r.status === "Submitted" || r.status === "Auto Submitted" || r.status === "In Progress" || (r.score !== null && r.score !== undefined));
        }
        const rows = list.map((r, idx) => {
            const roll = String(r.rollNumber || r.roll_number || "").toUpperCase().trim();
            const studentName = String(r.studentName || r.name || "").trim();
            const email = String(r.email || (roll ? `${roll.toLowerCase()}@kits.edu.in` : "")).trim();
            const marks = (r.marksObtained !== null && r.marksObtained !== undefined) ? Number(r.marksObtained) : (r.score !== null && r.score !== undefined ? Number(r.score) : "");
            const examMaxMarks = (activeCompletedExam && activeCompletedExam.total_marks) || (r.totalMarks || 50);
            const totalMarks = marks !== "" ? examMaxMarks : "";
            const pct = (r.percentage !== null && r.percentage !== undefined) ? `${Number(r.percentage)}%` : (marks !== "" ? `${Math.round((marks / examMaxMarks) * 100)}%` : "");

            return {
                "S.No.": idx + 1,
                "Roll Number": roll,
                "Student Name": studentName,
                "College Email": email,
                "Branch": r.branch || r.department || "Information Technology",
                "Academic Year": r.academic_year || r.academicYear || "2nd Year B.Tech (2026-27)",
                "Batch": r.batch || "2026-27",
                "Exam Name": examTitle || "Python & Computational Engineering Assessment",
                "Marks Obtained": marks,
                "Total Marks": totalMarks,
                "Percentage": pct,
                "Attempt Status": r.attemptStatus || r.status || "Not Attempted",
                "Start Time (IST)": r.started_at ? formatDateTime(r.started_at) : "--",
                "Submission Time (IST)": r.submitted_at ? formatDateTime(r.submitted_at) : "--"
            };
        });
        const fileBase = sanitizeFileName(examTitle || "Examination");
        exportToExcel(rows, `${fileBase}_Official_Results.xlsx`, "Results");
    }

    // =========================================================================
    // 3. NAVIGATION CONTROLLER (5 STRICT MODULES)
    // =========================================================================
    const TITLES = {
        dashboard: "Administrator Dashboard",
        exams: "Exam Management",
        students: "Students List",
        "monitoring-live": "Live Examination Monitoring",
        "completed-exams": "Completed Examinations & Results",
        revalidation: "Student Revalidation Requests"
    };

    let activeTab = "dashboard";

    function switchView(target) {
        if (!TITLES[target]) target = "dashboard";
        activeTab = target;

        $$(".sidebar-nav .nav-item").forEach(item => {
            const matches = item.getAttribute("data-view-target") === target;
            item.classList.toggle("active", matches);
        });

        $$(".view").forEach(v => {
            const matches = v.getAttribute("data-view") === target;
            v.classList.toggle("active", matches);
        });

        if ($("#viewBreadcrumb")) {
            $("#viewBreadcrumb").textContent = TITLES[target] || "Administrator Dashboard";
        }

        // Trigger module loader
        if (target === "dashboard") loadDashboard();
        else if (target === "exams") loadExams();
        else if (target === "students") loadStudents();
        else if (target === "monitoring-live") loadLiveMonitoring();
        else if (target === "completed-exams") loadCompletedExams();
        else if (target === "revalidation") loadRevalidationRequests();
    }

    $$(".sidebar-nav [data-view-target]").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-view-target");
            switchView(target);
        });
    });

    // Mobile sidebar toggle
    const menuBtn = $("#menuButton");
    const sidebar = $("#sidebar");
    const sidebarScrim = $("#sidebarScrim");
    if (menuBtn && sidebar) {
        menuBtn.addEventListener("click", () => {
            sidebar.classList.toggle("open");
            if (sidebarScrim) sidebarScrim.classList.toggle("open");
        });
    }
    if (sidebarScrim) {
        sidebarScrim.addEventListener("click", () => {
            sidebar.classList.remove("open");
            sidebarScrim.classList.remove("open");
        });
    }

    // Dashboard Quick Actions
    const dashCreateExamBtn = $("#dashCreateExamBtn");
    if (dashCreateExamBtn) {
        dashCreateExamBtn.addEventListener("click", () => {
            switchView("exams");
            openExamModal(null);
        });
    }

    const dashMonitorBtn = $("#dashMonitorBtn");
    if (dashMonitorBtn) {
        dashMonitorBtn.addEventListener("click", () => {
            switchView("monitoring-live");
        });
    }

    const dashViewAllExamsBtn = $("#dashViewAllExamsBtn");
    if (dashViewAllExamsBtn) {
        dashViewAllExamsBtn.addEventListener("click", () => {
            switchView("exams");
        });
    }

    // =========================================================================
    // 4. MODULE 1: DASHBOARD
    // =========================================================================
    let allExamsList = [];

    async function loadDashboard() {
        try {
            const [examsRes, studentsRes] = await Promise.all([
                adminFetch("/api/admin/exams"),
                adminFetch("/api/admin/students")
            ]);

            if (examsRes.ok) {
                const exData = await examsRes.json();
                allExamsList = exData.examinations || [];
            }
            if (studentsRes.ok) {
                const stdData = await studentsRes.json();
                allStudents = stdData.students || [];
            }
        } catch (e) {
            console.warn("[DASHBOARD-FETCH]", e.message);
        }

        renderDashboardOverview();
    }

    function renderDashboardOverview() {
        const totalExams = allExamsList.length;
        const activeExams = allExamsList.filter(e => e.status === "published").length;
        const totalStudents = allStudents.length;
        const totalCompleted = allExamsList.reduce((sum, e) => sum + (Number(e.totalCompleted) || 0), 0);

        if ($("#statDashboardExams")) $("#statDashboardExams").textContent = totalExams;
        if ($("#statDashboardActive")) $("#statDashboardActive").textContent = activeExams;
        if ($("#statDashboardStudents")) $("#statDashboardStudents").textContent = totalStudents;
        if ($("#statDashboardCompleted")) $("#statDashboardCompleted").textContent = totalCompleted;

        const tbody = $("#dashboardExamsTableBody");
        if (!tbody) return;

        if (allExamsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No examinations scheduled yet. Click 'Create Examination' to set up your first exam.</td></tr>`;
            return;
        }

        tbody.innerHTML = allExamsList.map(e => {
            const isPub = e.status === "published";
            return `
                <tr>
                    <td><strong>${escapeHtml(e.title || e.name)}</strong></td>
                    <td>${escapeHtml(e.scheduled_start_ist || "Scheduled in IST")}</td>
                    <td>60 Minutes</td>
                    <td><span class="badge-pill badge-gold">50 MCQs • 50 Marks</span></td>
                    <td><strong>${Number(e.totalEligibleStudents !== undefined ? e.totalEligibleStudents : (e.totalAssigned || 0))}</strong> candidates</td>
                    <td><strong>${Number(e.totalCompleted) || 0}</strong> submissions</td>
                    <td><span class="${isPub ? 'badge-active' : 'badge-suspended'}">${isPub ? 'Published' : 'Draft'}</span></td>
                    <td class="actions-column">
                        <button class="button-primary btn-sm" data-dash-monitor="${escapeHtml(e.id)}" style="background:linear-gradient(135deg, #d4af37, #b8860b); color:#1a1a1a; font-weight:700;">
                            Live Monitor →
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        $$("[data-dash-monitor]").forEach(btn => {
            btn.addEventListener("click", () => {
                const examId = btn.getAttribute("data-dash-monitor");
                const ex = allExamsList.find(e => e.id === examId);
                const isCompleted = ex && (ex.status === "completed" || ex.status === "closed");
                if (isCompleted) {
                    switchView("completed-exams");
                    loadCompletedExams(examId);
                } else {
                    switchView("monitoring-live");
                    loadLiveMonitoring(examId);
                }
            });
        });
    }

    // =========================================================================
    // 5. MODULE 2: EXAM MANAGEMENT (PRIMARY MODULE)
    // =========================================================================
    let currentEditingExam = null;
    let currentQuestionsDraft = [];

    async function loadExams() {
        try {
            const res = await adminFetch("/api/admin/exams");
            if (res.ok) {
                const data = await res.json();
                allExamsList = data.examinations || [];
            }
        } catch (err) {
            console.warn("[EXAMS-FETCH-ERROR]", err.message);
        }

        renderExamsTable();
    }

    function renderExamsTable() {
        const tbody = $("#examsTableBody");
        if (!tbody) return;

        const searchVal = ($("#examSearchInput")?.value || "").trim().toLowerCase();
        const statusVal = ($("#examStatusFilter")?.value || "").trim();

        const filtered = allExamsList.filter(e => {
            const titleMatch = (e.title || e.name || "").toLowerCase().includes(searchVal) || (e.id || "").toLowerCase().includes(searchVal);
            const statusMatch = !statusVal || e.status === statusVal;
            return titleMatch && statusMatch;
        });

        const publishedCount = allExamsList.filter(e => e.status === "published").length;
        if ($("#statTotalExams")) $("#statTotalExams").textContent = allExamsList.length;
        if ($("#statPublishedExams")) $("#statPublishedExams").textContent = publishedCount;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No examinations match the search filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(e => {
            const isPub = e.status === "published";
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(e.title || e.name)}</strong>
                        <div style="font-size:11px; color:#64748b;">ID: ${escapeHtml(e.id)}</div>
                    </td>
                    <td><strong>${escapeHtml(e.scheduled_start_ist || "Scheduled in IST")}</strong></td>
                    <td>${e.duration_minutes || 60} Mins</td>
                    <td><strong>${e.total_questions || 50}</strong> MCQs</td>
                    <td>${e.total_marks || 50} Marks</td>
                    <td><strong>${Number(e.totalEligibleStudents !== undefined ? e.totalEligibleStudents : (e.totalAssigned || 0))}</strong> students</td>
                    <td><strong>${Number(e.totalAttempted) || 0}</strong> attempts</td>
                    <td><span class="${isPub ? 'badge-active' : 'badge-suspended'}">${isPub ? 'Published' : 'Draft'}</span></td>
                    <td class="actions-column">
                        <button class="button-secondary btn-sm" data-review-exam="${escapeHtml(e.id)}" title="Manage, edit, or add questions">
                            <svg class="icon"><use href="#icon-questions"></use></svg> Manage Questions
                        </button>
                        <button class="button-secondary btn-sm" data-monitor-exam="${escapeHtml(e.id)}" title="Open live candidate monitoring">
                            <svg class="icon"><use href="#icon-results"></use></svg> Monitor
                        </button>
                        <button class="button-secondary btn-sm" data-toggle-exam="${escapeHtml(e.id)}" title="${isPub ? 'Unpublish' : 'Publish'} exam">
                            ${isPub ? 'Unpublish' : 'Publish'}
                        </button>
                        <button class="button-secondary btn-sm" data-delete-exam="${escapeHtml(e.id)}" style="color:#dc2626; border-color:#fecaca;" title="Permanently delete examination">
                            <svg class="icon"><use href="#icon-trash"></use></svg> Delete
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        // Wire Review 50 MCQs
        $$("[data-review-exam]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-review-exam");
                openQuestionsReviewModal(id);
            });
        });

        // Wire Monitor
        $$("[data-monitor-exam]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-monitor-exam");
                const ex = allExamsList.find(e => e.id === id);
                const isCompleted = ex && (ex.status === "completed" || ex.status === "closed");
                if (isCompleted) {
                    switchView("completed-exams");
                    loadCompletedExams(id);
                } else {
                    switchView("monitoring-live");
                    loadLiveMonitoring(id);
                }
            });
        });

        // Wire Toggle Publish
        $$("[data-toggle-exam]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-toggle-exam");
                try {
                    const res = await adminFetch("/api/admin/exams/publish", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ examId: id })
                    });
                    if (res.ok) {
                        showToast("Examination publish status updated.");
                        await loadExams();
                    }
                } catch (e) {
                    showToast("Error updating publish status: " + e.message, true);
                }
            });
        });

        // Wire Safe Delete
        $$("[data-delete-exam]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-delete-exam");
                openSafeDeleteModal(id);
            });
        });
    }

    ["#examSearchInput", "#examStatusFilter"].forEach(sel => {
        const el = $(sel);
        if (el) el.addEventListener("input", renderExamsTable);
    });

    // Create Exam Modal
    const openCreateExamBtn = $("#openCreateExamBtn");
    if (openCreateExamBtn) {
        openCreateExamBtn.addEventListener("click", () => openExamModal(null));
    }

    function openExamModal(examId) {
        const modal = $("#examCreateModal");
        if (!modal) return;

        const isEdit = Boolean(examId);
        const titleEl = $("#examCreateTitle");
        if (titleEl) titleEl.textContent = isEdit ? "Edit 50-MCQ Examination" : "Create 50-MCQ Examination";

        const exam = isEdit ? allExamsList.find(e => e.id === examId) : null;
        currentEditingExam = exam;

        // Default to today and standard hour
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const nextHour = String((now.getHours() + 1) % 24).padStart(2, "0") + ":00";

        $("#examFormId").value = exam ? exam.id : "";
        $("#examFormTitle").value = exam ? (exam.title || exam.name) : "Python & Computational Engineering Assessment";
        $("#examFormDate").value = exam && exam.scheduled_date ? exam.scheduled_date : todayStr;
        $("#examFormTime").value = exam && exam.scheduled_time ? exam.scheduled_time : nextHour;
        $("#examFormDuration").value = exam && exam.duration_minutes ? exam.duration_minutes : 60;
        $("#examFormDesc").value = exam ? (exam.description || "") : "Dynamic Assessment with configurable questions and marks.";
        $("#examCreateStatus").textContent = "";

        // Dynamic Configuration inputs
        const targetQ = exam ? (exam.total_questions || (exam.questions ? exam.questions.length : 50)) : 50;
        const targetM = exam ? (exam.total_marks || (exam.questions ? exam.questions.reduce((s,q) => s + (Number(q.marks) || 1), 0) : 50)) : 50;
        const marksMode = exam ? (exam.marks_mode || "equal") : "equal";
        const marksPerQ = exam ? (exam.marks_per_question || (targetQ > 0 ? targetM / targetQ : 1)) : 1;
        const isCompulsory = exam ? (exam.is_compulsory !== false) : true;
        const negMarking = exam ? Boolean(exam.negative_marking) : false;
        const negValue = exam ? (exam.negative_mark_value !== undefined ? exam.negative_mark_value : 0.25) : 0.25;

        if ($("#examConfigQuestionCount")) $("#examConfigQuestionCount").value = targetQ;
        if ($("#examConfigTotalMarks")) $("#examConfigTotalMarks").value = targetM;
        if ($("#examMarksModeSelect")) $("#examMarksModeSelect").value = marksMode;
        if ($("#examConfigMarksPerQ")) $("#examConfigMarksPerQ").value = marksPerQ;
        if ($("#examCompulsorySelect")) $("#examCompulsorySelect").value = String(isCompulsory);
        if ($("#examNegativeMarkingToggle")) $("#examNegativeMarkingToggle").checked = negMarking;
        if ($("#examNegativeMarkValue")) {
            $("#examNegativeMarkValue").value = String(negValue);
            $("#examNegativeMarkValue").style.display = negMarking ? "inline-block" : "none";
        }
        if ($("#examTypeMcq")) {
            $("#examTypeMcq").checked = exam && exam.question_types ? exam.question_types.includes("mcq") : true;
        }
        if ($("#examTypeMsq")) {
            $("#examTypeMsq").checked = exam && exam.question_types ? exam.question_types.includes("msq") : true;
        }

        // Preload questions
        currentQuestionsDraft = (exam && exam.questions && exam.questions.length > 0) 
            ? JSON.parse(JSON.stringify(exam.questions)) 
            : JSON.parse(JSON.stringify(window.DEFAULT_50_MCQS || []));

        updateQuestionsDraftUI();
        setModal(modal, true);
    }

    function updateQuestionsDraftUI() {
        const count = currentQuestionsDraft.length;
        const totalMarks = currentQuestionsDraft.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);
        const duration = parseInt($("#examFormDuration")?.value, 10) || (currentEditingExam?.duration_minutes || 60);

        const targetCount = parseInt($("#examConfigQuestionCount")?.value, 10) || count;
        const targetTotalMarks = parseFloat($("#examConfigTotalMarks")?.value) || totalMarks;
        const mode = $("#examMarksModeSelect")?.value || "equal";

        if ($("#examQuestionsCountBadge")) $("#examQuestionsCountBadge").textContent = `${count} Questions Loaded (${totalMarks} Marks)`;
        if ($("#btnQuestionsCount")) $("#btnQuestionsCount").textContent = count;
        if ($("#examFormTotalSummary")) $("#examFormTotalSummary").value = `${count} Loaded • Target: ${targetCount} Qs / ${targetTotalMarks} Marks`;

        if ($("#reviewModalBadge")) $("#reviewModalBadge").textContent = `${count} Questions`;
        if ($("#reviewModalMarksBadge")) $("#reviewModalMarksBadge").textContent = `${totalMarks} Total Marks`;
        if ($("#reviewModalDurationBadge")) $("#reviewModalDurationBadge").textContent = `${duration} Minutes Duration`;

        validateAndRenderConfigBanner();
    }

    function validateAndRenderConfigBanner() {
        const alertEl = $("#examConfigValidationAlert");
        if (!alertEl) return true;

        const count = currentQuestionsDraft.length;
        const actualMarks = Math.round(currentQuestionsDraft.reduce((sum, q) => sum + (Number(q.marks) || 1), 0) * 100) / 100;
        const targetCount = parseInt($("#examConfigQuestionCount")?.value, 10) || 0;
        const targetMarks = parseFloat($("#examConfigTotalMarks")?.value) || 0;
        const mode = $("#examMarksModeSelect")?.value || "equal";
        const mcqChecked = Boolean($("#examTypeMcq")?.checked);
        const msqChecked = Boolean($("#examTypeMsq")?.checked);

        if (!mcqChecked && !msqChecked) {
            alertEl.style.display = "block";
            alertEl.style.background = "#fee2e2";
            alertEl.style.color = "#991b1b";
            alertEl.style.border = "1px solid #f87171";
            alertEl.innerHTML = "<strong>Validation Error:</strong> You must select at least one question type (MCQ or MSQ).";
            return false;
        }

        if (count > 0 && targetCount > 0 && count !== targetCount) {
            alertEl.style.display = "block";
            alertEl.style.background = "#fef3c7";
            alertEl.style.color = "#92400e";
            alertEl.style.border = "1px solid #fde68a";
            alertEl.innerHTML = `<strong>Count Discrepancy:</strong> Target question count is <b>${targetCount}</b>, but <b>${count}</b> questions are loaded in the draft.`;
            return false;
        }

        if (count > 0 && Math.abs(actualMarks - targetMarks) > 0.05) {
            alertEl.style.display = "block";
            alertEl.style.background = "#fef3c7";
            alertEl.style.color = "#92400e";
            alertEl.style.border = "1px solid #fde68a";
            alertEl.innerHTML = `<strong>Marks Discrepancy:</strong> Target total marks is <b>${targetMarks}</b>, but sum of question marks is <b>${actualMarks}</b>. Adjust individual marks or switch to Equal mode.`;
            return false;
        }

        alertEl.style.display = "block";
        alertEl.style.background = "#f0fdf4";
        alertEl.style.color = "#166534";
        alertEl.style.border = "1px solid #86efac";
        const perQStr = targetCount > 0 ? (targetMarks / targetCount).toFixed(2) : "1.00";
        alertEl.innerHTML = `<strong>✓ Configuration Validated:</strong> Target: ${targetCount} questions, ${targetMarks} marks. Mode: ${mode === 'equal' ? 'Equal marks (' + perQStr + '/q)' : 'Variable marks'}. Ready for release.`;
        return true;
    }

    const examFormDurationInput = $("#examFormDuration");
    if (examFormDurationInput) {
        examFormDurationInput.addEventListener("input", updateQuestionsDraftUI);
    }

    const configQCountInp = $("#examConfigQuestionCount");
    const configTMarksInp = $("#examConfigTotalMarks");
    const marksModeSelect = $("#examMarksModeSelect");
    const marksPerQInp = $("#examConfigMarksPerQ");
    const negToggle = $("#examNegativeMarkingToggle");
    const negValueSelect = $("#examNegativeMarkValue");

    if (negToggle && negValueSelect) {
        negToggle.addEventListener("change", () => {
            negValueSelect.style.display = negToggle.checked ? "inline-block" : "none";
        });
    }

    if (configQCountInp && configTMarksInp && marksPerQInp && marksModeSelect) {
        function autoSyncMarks() {
            const mode = marksModeSelect.value;
            const qCount = parseInt(configQCountInp.value, 10) || 1;
            const tMarks = parseFloat(configTMarksInp.value) || qCount;

            if (mode === "equal") {
                const perQ = Math.round((tMarks / qCount) * 100) / 100;
                marksPerQInp.value = perQ;
                marksPerQInp.disabled = false;
                if (currentQuestionsDraft.length > 0) {
                    currentQuestionsDraft.forEach(q => { q.marks = perQ; });
                }
            } else {
                marksPerQInp.disabled = true;
            }
            updateQuestionsDraftUI();
        }

        configQCountInp.addEventListener("input", autoSyncMarks);
        configTMarksInp.addEventListener("input", autoSyncMarks);
        marksModeSelect.addEventListener("change", autoSyncMarks);
        marksPerQInp.addEventListener("input", () => {
            const mode = marksModeSelect.value;
            if (mode === "equal") {
                const perQ = parseFloat(marksPerQInp.value) || 1;
                const qCount = parseInt(configQCountInp.value, 10) || 1;
                configTMarksInp.value = Math.round(perQ * qCount * 100) / 100;
                if (currentQuestionsDraft.length > 0) {
                    currentQuestionsDraft.forEach(q => { q.marks = perQ; });
                }
                updateQuestionsDraftUI();
            }
        });
    }

    if ($("#examTypeMcq")) $("#examTypeMcq").addEventListener("change", updateQuestionsDraftUI);
    if ($("#examTypeMsq")) $("#examTypeMsq").addEventListener("change", updateQuestionsDraftUI);

    // =========================================================================
    // 3-PDF EXAM IMPORT & AUTO-MAPPING LOGIC
    // =========================================================================
    let selectedPdfFile = null;
    let selectedKeyPdfFile = null;
    let selectedExpPdfFile = null;

    function wirePdfDropzone(dropzoneSelector, inputSelector, browseBtnSelector, infoSelector, nameSelector, statusSelector, onSelected) {
        const dropzone = $(dropzoneSelector);
        const input = $(inputSelector);
        const browseBtn = $(browseBtnSelector);
        const infoEl = $(infoSelector);
        const nameEl = $(nameSelector);
        const statusEl = $(statusSelector);

        if (browseBtn && input) {
            browseBtn.addEventListener("click", () => input.click());
        }

        if (dropzone && input) {
            dropzone.addEventListener("click", (e) => {
                if (e.target !== browseBtn) input.click();
            });
            dropzone.addEventListener("dragover", e => {
                e.preventDefault();
                dropzone.style.borderColor = "#c59b27";
                dropzone.style.background = "#fbf6ea";
            });
            dropzone.addEventListener("dragleave", () => {
                dropzone.style.borderColor = "#cbd5e1";
                dropzone.style.background = "#fafafa";
            });
            dropzone.addEventListener("drop", e => {
                e.preventDefault();
                dropzone.style.borderColor = "#cbd5e1";
                dropzone.style.background = "#fafafa";
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    processFile(e.dataTransfer.files[0]);
                }
            });
        }

        if (input) {
            input.addEventListener("change", e => {
                if (e.target.files && e.target.files[0]) {
                    processFile(e.target.files[0]);
                }
            });
        }

        function processFile(file) {
            if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
                showToast("Please upload a valid PDF file.", true);
                return;
            }
            if (infoEl) infoEl.classList.remove("hidden");
            if (nameEl) nameEl.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
            if (statusEl) statusEl.textContent = "Ready for processing.";
            onSelected(file);
        }
    }

    // 1. Question Paper PDF
    wirePdfDropzone("#examPdfDropzone", "#examPdfFileInput", "#browsePdfBtn", "#selectedPdfInfo", "#selectedPdfName", "#examPdfStatus", file => {
        selectedPdfFile = file;
    });

    // 2. Answer Key PDF
    wirePdfDropzone("#examKeyPdfDropzone", "#examKeyPdfFileInput", "#browseKeyPdfBtn", "#selectedKeyPdfInfo", "#selectedKeyPdfName", "#examKeyPdfStatus", file => {
        selectedKeyPdfFile = file;
    });

    // 3. Explanations PDF
    wirePdfDropzone("#examExpPdfDropzone", "#examExpPdfFileInput", "#browseExpPdfBtn", "#selectedExpPdfInfo", "#selectedExpPdfName", "#examExpPdfStatus", file => {
        selectedExpPdfFile = file;
    });

    // Extract Text Helper using PDF.js
    async function extractRawTextFromPdf(file) {
        if (typeof pdfjsLib === "undefined") {
            throw new Error("PDF.js library is not loaded.");
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const items = textContent.items || [];
            if (items.length > 0) {
                const sortedItems = [...items].sort((a, b) => {
                    const yA = a.transform ? a.transform[5] : 0;
                    const yB = b.transform ? b.transform[5] : 0;
                    if (Math.abs(yB - yA) > 3) return yB - yA;
                    const xA = a.transform ? a.transform[4] : 0;
                    const xB = b.transform ? b.transform[4] : 0;
                    return xA - xB;
                });

                const pageLines = [];
                let currentLine = [];
                let lastY = null;

                sortedItems.forEach(item => {
                    const y = item.transform ? item.transform[5] : 0;
                    const str = (item.str || "").trim();
                    if (!str && !item.hasEOL) return;

                    if (lastY === null || Math.abs(y - lastY) > 4) {
                        if (currentLine.length > 0) {
                            pageLines.push(currentLine.join(" ").trim());
                            currentLine = [];
                        }
                        lastY = y;
                    }
                    if (str) currentLine.push(str);
                    if (item.hasEOL) {
                        pageLines.push(currentLine.join(" ").trim());
                        currentLine = [];
                        lastY = null;
                    }
                });
                if (currentLine.length > 0) pageLines.push(currentLine.join(" ").trim());
                fullText += "\n" + pageLines.filter(Boolean).join("\n");
            }
        }

        if (fullText.trim().length < 60 && typeof Tesseract !== "undefined") {
            try {
                const ocr = await Tesseract.recognize(file, "eng");
                if (ocr && ocr.data && ocr.data.text) fullText = ocr.data.text;
            } catch (_) {}
        }

        return fullText;
    }

    // Answer Key text parser: maps question number -> answer key ("A", "B", "A, C")
    function parseAnswerKeysText(text) {
        const keysMap = {};
        if (!text) return keysMap;

        const lines = text.split(/\r?\n/);
        lines.forEach(l => {
            const trimmed = l.trim();
            if (!trimmed) return;
            const lineMatch = trimmed.match(/^(?:Q(?:uestion)?\s*[\.:\-]?\s*|\b)(\d{1,3})[\.\:\)\-\s]+(?:\()?([A-D](?:\s*,\s*[A-D])*|\b[A-D]\b)(?:\))?$/i);
            if (lineMatch) {
                const qNum = parseInt(lineMatch[1], 10);
                keysMap[qNum] = lineMatch[2].trim().toUpperCase();
            }
        });

        // Regex scan across text for tabular format e.g. "1. A  2. B  3. C"
        const regex = /(?:Q(?:uestion)?\s*[\.:\-]?\s*|\b)(\d{1,3})[\.\:\)\-\s]+(?:\()?([A-D](?:\s*,\s*[A-D])*|\b[A-D]\b)(?:\))?/gi;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const qNum = parseInt(match[1], 10);
            const key = match[2].trim().toUpperCase();
            if (qNum > 0 && qNum <= 200 && key && !keysMap[qNum]) {
                keysMap[qNum] = key;
            }
        }

        return keysMap;
    }

    // Explanations text parser: maps question number -> explanation string
    function parseExplanationsText(text) {
        const expMap = {};
        if (!text) return expMap;

        const lines = text.split(/\r?\n/);
        let currentQ = null;
        let currentExpLines = [];
        const qHeaderRegex = /^(?:Q(?:uestion)?\s*[\.:\-]?\s*|\b)(\d{1,3})[\.\:\)\-]\s*(?:Explanation[\:\-]?\s*)?(.*)$/i;

        function commitCurrent() {
            if (currentQ !== null && currentExpLines.length > 0) {
                expMap[currentQ] = currentExpLines.join(" ").trim();
            }
        }

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const match = trimmed.match(qHeaderRegex);
            if (match) {
                commitCurrent();
                currentQ = parseInt(match[1], 10);
                currentExpLines = match[2] ? [match[2].trim()] : [];
            } else if (currentQ !== null) {
                currentExpLines.push(trimmed);
            }
        });
        commitCurrent();
        return expMap;
    }

    // Auto-Extract & Auto-Map 3-PDF Button
    const extractAllPdfsBtn = $("#extractAllPdfsBtn");
    if (extractAllPdfsBtn) {
        extractAllPdfsBtn.addEventListener("click", async () => {
            const summaryEl = $("#pdfBundleSummary");
            if (!selectedPdfFile && !selectedKeyPdfFile && !selectedExpPdfFile) {
                showToast("Please upload at least the Question Paper PDF.", true);
                if (summaryEl) summaryEl.textContent = "Please upload at least the Question Paper PDF.";
                return;
            }

            if (summaryEl) summaryEl.textContent = "Extracting text and auto-mapping bundle...";
            showToast("Processing 3-PDF bundle...");

            try {
                let parsedQuestions = [];
                if (selectedPdfFile) {
                    if ($("#examPdfStatus")) $("#examPdfStatus").textContent = "Extracting questions...";
                    parsedQuestions = await extractQuestionsFromPdfFile(selectedPdfFile);
                    if ($("#examPdfStatus")) $("#examPdfStatus").textContent = `✓ Extracted ${parsedQuestions.length} questions`;
                } else if (currentQuestionsDraft.length > 0) {
                    parsedQuestions = JSON.parse(JSON.stringify(currentQuestionsDraft));
                } else {
                    parsedQuestions = JSON.parse(JSON.stringify(window.DEFAULT_50_MCQS || []));
                }

                // Answer Keys PDF Extraction
                let keysMap = {};
                if (selectedKeyPdfFile) {
                    if ($("#examKeyPdfStatus")) $("#examKeyPdfStatus").textContent = "Extracting answer keys...";
                    const keyText = await extractRawTextFromPdf(selectedKeyPdfFile);
                    keysMap = parseAnswerKeysText(keyText);
                    if ($("#examKeyPdfStatus")) $("#examKeyPdfStatus").textContent = `✓ Extracted ${Object.keys(keysMap).length} keys`;
                }

                // Explanations PDF Extraction
                let expMap = {};
                if (selectedExpPdfFile) {
                    if ($("#examExpPdfStatus")) $("#examExpPdfStatus").textContent = "Extracting explanations...";
                    const expText = await extractRawTextFromPdf(selectedExpPdfFile);
                    expMap = parseExplanationsText(expText);
                    if ($("#examExpPdfStatus")) $("#examExpPdfStatus").textContent = `✓ Extracted ${Object.keys(expMap).length} explanations`;
                }

                // Auto-map keys and explanations onto parsed questions
                let mappedKeysCount = 0;
                let mappedExpCount = 0;

                parsedQuestions.forEach((q, idx) => {
                    const qNum = q.question_number || (idx + 1);
                    if (keysMap[qNum]) {
                        const rawKey = keysMap[qNum];
                        if (rawKey.includes(",")) {
                            q.type = "msq";
                            q.correct_answers = rawKey.split(",").map(s => s.trim().toUpperCase());
                            q.correct_answer = q.correct_answers[0];
                        } else {
                            q.type = "mcq";
                            q.correct_answer = rawKey.toUpperCase();
                        }
                        mappedKeysCount++;
                    }
                    if (expMap[qNum]) {
                        q.explanation = expMap[qNum];
                        mappedExpCount++;
                    }
                });

                currentQuestionsDraft = parsedQuestions;
                updateQuestionsDraftUI();

                const summaryText = `✓ Auto-mapped ${parsedQuestions.length} questions (${mappedKeysCount} keys, ${mappedExpCount} explanations)`;
                if (summaryEl) summaryEl.textContent = summaryText;
                showToast(summaryText);
            } catch (err) {
                console.error("[3-PDF-EXTRACT-ERROR]", err);
                if (summaryEl) summaryEl.textContent = "Extraction error: " + err.message;
                showToast("Extraction error: " + err.message, true);
            }
        });
    }

    // PDF text parser using pdfjsLib
    async function extractQuestionsFromPdfFile(file) {
        if (typeof pdfjsLib === "undefined") {
            throw new Error("PDF.js library is not loaded.");
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            // Reconstruct lines using vertical Y coordinates and horizontal X ordering
            const items = textContent.items || [];
            if (items.length > 0) {
                const sortedItems = [...items].sort((a, b) => {
                    const yA = a.transform ? a.transform[5] : 0;
                    const yB = b.transform ? b.transform[5] : 0;
                    if (Math.abs(yB - yA) > 3) return yB - yA;
                    const xA = a.transform ? a.transform[4] : 0;
                    const xB = b.transform ? b.transform[4] : 0;
                    return xA - xB;
                });

                const pageLines = [];
                let currentLine = [];
                let lastY = null;

                sortedItems.forEach(item => {
                    const y = item.transform ? item.transform[5] : 0;
                    const str = (item.str || "").trim();
                    if (!str && !item.hasEOL) return;

                    if (lastY === null || Math.abs(y - lastY) > 4) {
                        if (currentLine.length > 0) {
                            pageLines.push(currentLine.join(" ").trim());
                            currentLine = [];
                        }
                        lastY = y;
                    }
                    if (str) currentLine.push(str);
                    if (item.hasEOL) {
                        pageLines.push(currentLine.join(" ").trim());
                        currentLine = [];
                        lastY = null;
                    }
                });
                if (currentLine.length > 0) pageLines.push(currentLine.join(" ").trim());
                fullText += "\n" + pageLines.filter(Boolean).join("\n");
            }
        }

        if (fullText.trim().length < 60 && typeof Tesseract !== "undefined") {
            const ocr = await Tesseract.recognize(file, "eng");
            fullText = ocr.data.text;
        }

        return parseQuestionsFromRawText(fullText);
    }

    function parseQuestionsFromRawText(text) {
        if (!text || typeof text !== "string") return [];
        
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const rawQuestions = [];
        let currentQ = null;

        const qStartRegex = /^(?:Q(?:uestion)?\s*[\.:\-]?\s*|\b)(\d{1,3})[\.\:\)\-]\s*(.*)$/i;
        const ansKeyRegex = /^(?:Ans(?:wer)?|Correct\s*Ans(?:wer)?|Key)[\s\:\-\.\)]+([A-D])/i;
        const expRegex = /^(?:Explanation|Exp|Rationale)[\s\:\-\.]+(.*)$/i;
        const optLineRegex = /^(?:[\(\[]?([A-D])[\)\]\.\:\-]\s*|\b([A-D])[\.\:\)]\s+)(.*)$/i;

        function finalizeQuestion(q) {
            if (!q) return;
            
            let textLines = [];
            let rawOptions = { A: "", B: "", C: "", D: "" };
            let currentOpt = null;
            let answerKey = q.extractedAnswer || null;
            let explanationLines = q.extractedExpLines || [];
            let inExplanation = false;

            for (let i = 0; i < q.lines.length; i++) {
                const line = q.lines[i];

                // 1. Explanation line check
                const expMatch = line.match(expRegex);
                if (expMatch) {
                    inExplanation = true;
                    if (expMatch[1]) explanationLines.push(expMatch[1].trim());
                    currentOpt = null;
                    continue;
                }
                if (inExplanation) {
                    explanationLines.push(line);
                    continue;
                }

                // 2. Answer key line check
                const ansMatch = line.match(ansKeyRegex);
                if (ansMatch) {
                    answerKey = ansMatch[1].toUpperCase();
                    currentOpt = null;
                    continue;
                }

                // 3. Inline answer key detection
                const inlineAnsMatch = line.match(/(?:Ans(?:wer)?|Key)[\s\:\-]+([A-D])\b/i);
                let cleanLine = line;
                if (inlineAnsMatch) {
                    answerKey = inlineAnsMatch[1].toUpperCase();
                    cleanLine = cleanLine.replace(inlineAnsMatch[0], "").trim();
                }

                // 4. Multiple options on a single line (e.g. "(A) Apple (B) Banana (C) Cherry (D) Date")
                const multiOptParts = cleanLine.split(/(?:[\(\[]|^|\s)([A-D])[\)\]\.\:\-]\s*/i);
                if (multiOptParts.length >= 7) {
                    if (!currentOpt && multiOptParts[0].trim()) {
                        textLines.push(multiOptParts[0].trim());
                    }
                    for (let k = 1; k < multiOptParts.length; k += 2) {
                        const letter = (multiOptParts[k] || "").toUpperCase();
                        const optContent = (multiOptParts[k + 1] || "").trim();
                        if (["A", "B", "C", "D"].includes(letter)) {
                            rawOptions[letter] = optContent;
                            currentOpt = letter;
                        }
                    }
                    continue;
                }

                // 5. Single option start line (e.g. "A) Python" or "(A) Python")
                const optMatch = cleanLine.match(optLineRegex);
                if (optMatch) {
                    const letter = (optMatch[1] || optMatch[2] || "").toUpperCase();
                    const content = (optMatch[3] || "").trim();
                    if (["A", "B", "C", "D"].includes(letter)) {
                        currentOpt = letter;
                        rawOptions[letter] = content;
                        continue;
                    }
                }

                // 6. Multiline continuation
                if (currentOpt) {
                    rawOptions[currentOpt] += (rawOptions[currentOpt] ? " " : "") + cleanLine;
                } else {
                    textLines.push(cleanLine);
                }
            }

            const questionStatement = textLines.join(" ").replace(/\s+/g, " ").trim();
            const explanation = explanationLines.join(" ").replace(/\s+/g, " ").trim();

            const hasA = Boolean(rawOptions.A && rawOptions.A.trim());
            const hasB = Boolean(rawOptions.B && rawOptions.B.trim());
            const isAmbiguous = !hasA || !hasB || !questionStatement;

            rawQuestions.push({
                id: `q_${rawQuestions.length + 1}`,
                question_number: rawQuestions.length + 1,
                question_text: questionStatement || `Question ${rawQuestions.length + 1}`,
                statement: questionStatement || `Question ${rawQuestions.length + 1}`,
                option_a: rawOptions.A || "Option A",
                option_b: rawOptions.B || "Option B",
                option_c: rawOptions.C || "Option C",
                option_d: rawOptions.D || "Option D",
                correct_answer: answerKey || "A",
                explanation: explanation || "",
                marks: 1,
                needsReview: isAmbiguous,
                reviewReason: isAmbiguous ? "Incomplete options or statement detected from PDF" : ""
            });
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const qMatch = line.match(qStartRegex);

            if (qMatch) {
                if (currentQ) {
                    finalizeQuestion(currentQ);
                }
                currentQ = {
                    number: parseInt(qMatch[1], 10),
                    lines: qMatch[2].trim() ? [qMatch[2].trim()] : [],
                    extractedAnswer: null,
                    extractedExpLines: []
                };
            } else if (currentQ) {
                currentQ.lines.push(line);
            }
        }

        if (currentQ) {
            finalizeQuestion(currentQ);
        }

        return rawQuestions;
    }

    // Button: Use Standard 50-MCQ Bank
    const useStandardBankBtn = $("#useStandardBankBtn");
    if (useStandardBankBtn) {
        useStandardBankBtn.addEventListener("click", () => {
            currentQuestionsDraft = JSON.parse(JSON.stringify(window.DEFAULT_50_MCQS || []));
            updateQuestionsDraftUI();
            if ($("#examPdfStatus")) $("#examPdfStatus").textContent = "✓ Standard 50-MCQ Bank loaded.";
            showToast("Standard 50-MCQ Bank loaded successfully.");
        });
    }

    // Button: Preview / Edit 50 Questions
    const preview50QuestionsBtn = $("#preview50QuestionsBtn");
    if (preview50QuestionsBtn) {
        preview50QuestionsBtn.addEventListener("click", () => {
            openReviewQuestionsModalForDraft();
        });
    }

    function openQuestionsReviewModal(examId) {
        const exam = allExamsList.find(e => e.id === examId);
        if (!exam) return;
        currentEditingExam = exam;
        currentQuestionsDraft = (exam.questions && exam.questions.length > 0) 
            ? JSON.parse(JSON.stringify(exam.questions)) 
            : JSON.parse(JSON.stringify(window.DEFAULT_50_MCQS || []));
        openReviewQuestionsModalForDraft(exam.title || exam.name);
    }

    function openReviewQuestionsModalForDraft(examTitle = "") {
        const modal = $("#review50QuestionsModal");
        if (!modal) return;

        const titleText = examTitle || $("#examFormTitle")?.value || "Assessment";
        if ($("#reviewModalTitle")) $("#reviewModalTitle").textContent = `Manage & Preview Questions (${titleText})`;
        
        renderReviewQuestionCards();
        updateQuestionsDraftUI();
        setModal(modal, true);
    }

    function syncDraftFromDOM() {
        const cards = $$(".review-card");
        cards.forEach(card => {
            const idx = parseInt(card.getAttribute("data-q-idx"), 10);
            if (isNaN(idx) || !currentQuestionsDraft[idx]) return;
            const q = currentQuestionsDraft[idx];

            const textEl = card.querySelector(".q-text-input");
            const optAEl = card.querySelector(`[data-opt="a"]`);
            const optBEl = card.querySelector(`[data-opt="b"]`);
            const optCEl = card.querySelector(`[data-opt="c"]`);
            const optDEl = card.querySelector(`[data-opt="d"]`);
            const optEEl = card.querySelector(`[data-opt="e"]`);
            const typeEl = card.querySelector(".q-type-select");
            const marksEl = card.querySelector(".q-marks-input");
            const expEl = card.querySelector(".q-exp-input");

            if (textEl) q.question_text = q.statement = textEl.value.trim();
            if (optAEl) q.option_a = optAEl.value.trim();
            if (optBEl) q.option_b = optBEl.value.trim();
            if (optCEl) q.option_c = optCEl.value.trim();
            if (optDEl) q.option_d = optDEl.value.trim();
            if (optEEl) q.option_e = optEEl.value.trim();
            if (typeEl) q.type = typeEl.value;
            if (marksEl) q.marks = Math.max(1, parseInt(marksEl.value, 10) || 1);
            if (expEl) q.explanation = expEl.value.trim();

            if (q.type === "msq") {
                const checked = Array.from(card.querySelectorAll(".q-msq-check:checked")).map(cb => cb.value.toUpperCase());
                q.correct_answers = checked.length > 0 ? checked : ["A"];
                q.correct_answer = q.correct_answers.join(",");
            } else {
                const sel = card.querySelector(".q-correct-select");
                q.correct_answer = (sel ? sel.value : "A").toUpperCase();
                q.correct_answers = [q.correct_answer];
            }
        });
    }

    function renderReviewQuestionCards() {
        const container = $("#review50QuestionsList");
        if (!container) return;

        if (currentQuestionsDraft.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:36px 20px; background:#f8fafc; border:2px dashed #cbd5e1; border-radius:8px;">
                    <p style="color:#64748b; font-size:14px; margin-bottom:12px;">No questions in draft. Add a question or load standard question bank.</p>
                    <button class="button-primary btn-sm" type="button" onclick="window.KitsAdminAddNewQuestion()">+ Add First Question</button>
                </div>
            `;
            return;
        }

        container.innerHTML = currentQuestionsDraft.map((q, idx) => {
            const num = idx + 1;
            const isMsq = (q.type === "msq");
            const ans = String(q.correct_answer || "A").toUpperCase();
            const correctArr = Array.isArray(q.correct_answers) ? q.correct_answers.map(s => String(s).toUpperCase()) : [ans];
            const marksVal = Number(q.marks || 1);

            const reviewBadge = q.needsReview ? `
                <div style="margin-bottom:8px; padding:6px 10px; background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; font-size:12px; color:#b45309; font-weight:600;">
                    ⚠ Needs Review: ${escapeHtml(q.reviewReason || "Verify statement and options")}
                </div>
            ` : "";

            const answerControlHtml = isMsq ? `
                <div class="q-msq-container" style="display:flex; align-items:center; gap:8px; background:#f0fdf4; padding:4px 10px; border:1px solid #bbf7d0; border-radius:6px;">
                    <span style="font-size:11px; font-weight:700; color:#15803d;">Correct:</span>
                    <label style="cursor:pointer; font-size:12px; font-weight:700; color:#166534;"><input type="checkbox" class="q-msq-check" data-q-idx="${idx}" value="A" ${correctArr.includes("A") ? "checked" : ""}> A</label>
                    <label style="cursor:pointer; font-size:12px; font-weight:700; color:#166534;"><input type="checkbox" class="q-msq-check" data-q-idx="${idx}" value="B" ${correctArr.includes("B") ? "checked" : ""}> B</label>
                    <label style="cursor:pointer; font-size:12px; font-weight:700; color:#166534;"><input type="checkbox" class="q-msq-check" data-q-idx="${idx}" value="C" ${correctArr.includes("C") ? "checked" : ""}> C</label>
                    <label style="cursor:pointer; font-size:12px; font-weight:700; color:#166534;"><input type="checkbox" class="q-msq-check" data-q-idx="${idx}" value="D" ${correctArr.includes("D") ? "checked" : ""}> D</label>
                </div>
            ` : `
                <div style="display:flex; align-items:center; gap:6px;">
                    <label style="font-size:12px; font-weight:600; color:#475569;">Key:</label>
                    <select class="q-correct-select" data-q-idx="${idx}" style="padding:4px 8px; border:1px solid #cbd5e1; border-radius:6px; font-weight:700; background:#f0fdf4; color:#15803d; font-size:12px;">
                        <option value="A" ${ans === 'A' ? 'selected' : ''}>A</option>
                        <option value="B" ${ans === 'B' ? 'selected' : ''}>B</option>
                        <option value="C" ${ans === 'C' ? 'selected' : ''}>C</option>
                        <option value="D" ${ans === 'D' ? 'selected' : ''}>D</option>
                    </select>
                </div>
            `;

            return `
                <div class="review-card" data-q-idx="${idx}" style="margin-bottom:14px; border:1px solid #e2e8f0; border-radius:8px; padding:14px; background:#ffffff; transition:border-color 0.2s;">
                    ${reviewBadge}
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                        <span style="font-weight:700; color:#1e293b; font-size:14px;">
                            Question ${num} of ${currentQuestionsDraft.length}
                            <small style="font-size:11px; color:#64748b; font-weight:500;">(ID: ${escapeHtml(q.id || ('q_' + num))})</small>
                        </span>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <label style="font-size:12px; font-weight:600; color:#475569;">Type:
                                <select class="q-type-select" data-q-idx="${idx}" style="padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px; font-weight:600;">
                                    <option value="mcq" ${!isMsq ? 'selected' : ''}>Single (MCQ)</option>
                                    <option value="msq" ${isMsq ? 'selected' : ''}>Multiple (MSQ)</option>
                                </select>
                            </label>
                            <label style="font-size:12px; font-weight:600; color:#475569;">Marks:
                                <input type="number" class="q-marks-input" data-q-idx="${idx}" min="1" max="50" value="${marksVal}" style="width:48px; padding:3px 6px; border:1px solid #cbd5e1; border-radius:4px; font-weight:700; text-align:center; font-size:12px;">
                            </label>
                            ${answerControlHtml}
                            <button class="button-secondary btn-sm q-delete-btn" data-q-idx="${idx}" type="button" style="color:#dc2626; border-color:#fca5a5; font-size:12px; padding:3px 8px;" title="Delete this question">
                                🗑 Delete
                            </button>
                        </div>
                    </div>

                    <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">Question Statement *:</label>
                    <textarea class="q-text-input" data-q-idx="${idx}" rows="2" placeholder="Enter question statement..." style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; margin-bottom:10px;">${escapeHtml(q.question_text || q.statement || '')}</textarea>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <span style="font-size:11px; font-weight:700; color:#64748b;">(A) *</span>
                            <input class="q-opt-input" data-q-idx="${idx}" data-opt="a" value="${escapeHtml(q.option_a || '')}" placeholder="Option A text..." style="width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                        </div>
                        <div>
                            <span style="font-size:11px; font-weight:700; color:#64748b;">(B) *</span>
                            <input class="q-opt-input" data-q-idx="${idx}" data-opt="b" value="${escapeHtml(q.option_b || '')}" placeholder="Option B text..." style="width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                        </div>
                        <div>
                            <span style="font-size:11px; font-weight:700; color:#64748b;">(C)</span>
                            <input class="q-opt-input" data-q-idx="${idx}" data-opt="c" value="${escapeHtml(q.option_c || '')}" placeholder="Option C text..." style="width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                        </div>
                        <div>
                            <span style="font-size:11px; font-weight:700; color:#64748b;">(D)</span>
                            <input class="q-opt-input" data-q-idx="${idx}" data-opt="d" value="${escapeHtml(q.option_d || '')}" placeholder="Option D text..." style="width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                        </div>
                    </div>

                    <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">Academic Explanation (Optional):</label>
                    <textarea class="q-exp-input" data-q-idx="${idx}" rows="1" placeholder="Enter explanation for scorecard..." style="width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">${escapeHtml(q.explanation || '')}</textarea>
                </div>
            `;
        }).join("");

        // Wire dynamic event listeners on cards
        $$(".q-marks-input").forEach(input => {
            input.addEventListener("input", (e) => {
                const idx = parseInt(e.target.getAttribute("data-q-idx"), 10);
                if (currentQuestionsDraft[idx]) {
                    currentQuestionsDraft[idx].marks = Math.max(1, parseInt(e.target.value, 10) || 1);
                    updateQuestionsDraftUI();
                }
            });
        });

        $$(".q-type-select").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const idx = parseInt(e.target.getAttribute("data-q-idx"), 10);
                if (currentQuestionsDraft[idx]) {
                    syncDraftFromDOM();
                    currentQuestionsDraft[idx].type = e.target.value;
                    if (e.target.value === "msq" && (!currentQuestionsDraft[idx].correct_answers || currentQuestionsDraft[idx].correct_answers.length === 0)) {
                        currentQuestionsDraft[idx].correct_answers = ["A"];
                    }
                    renderReviewQuestionCards();
                    updateQuestionsDraftUI();
                }
            });
        });

        $$(".q-delete-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const idx = parseInt(btn.getAttribute("data-q-idx"), 10);
                if (isNaN(idx) || !currentQuestionsDraft[idx]) return;

                // Protect historical completed exams from silent corruption
                if (currentEditingExam && Number(currentEditingExam.totalAttempted || currentEditingExam.attemptCount || 0) > 0) {
                    alert("Cannot delete questions for an examination with existing candidate attempts. This protects historical student records and scorecards.");
                    return;
                }

                if (confirm(`Are you sure you want to delete Question ${idx + 1}? This cannot be undone.`)) {
                    syncDraftFromDOM();
                    currentQuestionsDraft.splice(idx, 1);
                    currentQuestionsDraft.forEach((q, i) => { q.question_number = i + 1; });
                    renderReviewQuestionCards();
                    updateQuestionsDraftUI();
                    showToast("Question deleted successfully.");
                }
            });
        });
    }

    function addNewQuestionToDraft() {
        syncDraftFromDOM();
        const newNum = currentQuestionsDraft.length + 1;
        currentQuestionsDraft.push({
            id: `q_manual_${Date.now()}_${newNum}`,
            question_number: newNum,
            question_text: "",
            statement: "",
            option_a: "",
            option_b: "",
            option_c: "",
            option_d: "",
            type: "mcq",
            marks: 1,
            correct_answer: "A",
            correct_answers: ["A"],
            explanation: "",
            needsReview: false
        });
        renderReviewQuestionCards();
        updateQuestionsDraftUI();

        const container = $("#review50QuestionsList");
        if (container) {
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
                const lastCard = container.querySelector(".review-card:last-child");
                if (lastCard) {
                    lastCard.style.borderColor = "#15803d";
                    lastCard.style.boxShadow = "0 0 0 2px rgba(22,163,74,0.2)";
                    const textEl = lastCard.querySelector(".q-text-input");
                    if (textEl) textEl.focus();
                }
            }, 60);
        }
        showToast(`Added Question ${newNum}. Fill in statement and options.`);
    }
    window.KitsAdminAddNewQuestion = addNewQuestionToDraft;

    // Button: Add New Question in Review Modal
    const addNewQuestionInReviewBtn = $("#addNewQuestionInReviewBtn");
    if (addNewQuestionInReviewBtn) {
        addNewQuestionInReviewBtn.addEventListener("click", addNewQuestionToDraft);
    }

    // Button: Add Question in Exam Create Modal
    const modalAddQuestionBtn = $("#modalAddQuestionBtn");
    if (modalAddQuestionBtn) {
        modalAddQuestionBtn.addEventListener("click", () => {
            openReviewQuestionsModalForDraft();
            addNewQuestionToDraft();
        });
    }

    function validateQuestionsDraft(draft) {
        if (!Array.isArray(draft) || draft.length === 0) {
            return { valid: false, message: "Please add or extract at least one question." };
        }

        for (let i = 0; i < draft.length; i++) {
            const q = draft[i];
            const text = (q.question_text || q.statement || "").trim();
            if (!text) {
                return { valid: false, idx: i, message: `Validation Error: Question ${i + 1} has an empty statement.` };
            }
            if (!q.option_a || !q.option_a.trim() || !q.option_b || !q.option_b.trim()) {
                return { valid: false, idx: i, message: `Validation Error: Question ${i + 1} must have at least Option A and Option B filled in.` };
            }
            if (q.type === "msq") {
                const answers = Array.isArray(q.correct_answers) ? q.correct_answers : (q.correct_answer ? q.correct_answer.split(",") : []);
                if (answers.length === 0) {
                    return { valid: false, idx: i, message: `Validation Error: Question ${i + 1} (MSQ) must have at least one correct answer option selected.` };
                }
            } else {
                if (!q.correct_answer || !["A", "B", "C", "D"].includes(String(q.correct_answer).toUpperCase())) {
                    return { valid: false, idx: i, message: `Validation Error: Question ${i + 1} must have a designated correct answer key.` };
                }
            }
            if (Number(q.marks) < 1) {
                return { valid: false, idx: i, message: `Validation Error: Question ${i + 1} marks must be at least 1.` };
            }
        }

        return { valid: true };
    }

    const returnFromReviewBtn = $("#returnFromReviewBtn");
    if (returnFromReviewBtn) {
        returnFromReviewBtn.addEventListener("click", () => {
            syncDraftFromDOM();
            updateQuestionsDraftUI();
            setModal($("#review50QuestionsModal"), false);
        });
    }

    const approve50QuestionsBtn = $("#approve50QuestionsBtn");
    if (approve50QuestionsBtn) {
        approve50QuestionsBtn.addEventListener("click", async () => {
            syncDraftFromDOM();
            const val = validateQuestionsDraft(currentQuestionsDraft);
            if (!val.valid) {
                showToast(val.message, true);
                if (val.idx !== undefined) {
                    const card = $$(".review-card")[val.idx];
                    if (card) {
                        card.scrollIntoView({ behavior: "smooth", block: "center" });
                        card.style.borderColor = "#dc2626";
                        card.style.boxShadow = "0 0 0 2px rgba(220,38,38,0.2)";
                    }
                }
                return;
            }

            // If we are editing an existing exam directly, persist immediately
            if (currentEditingExam && currentEditingExam.id && $("#examCreateModal")?.classList.contains("hidden")) {
                try {
                    const totalMarks = currentQuestionsDraft.reduce((s, q) => s + (Number(q.marks) || 1), 0);
                    const res = await adminFetch("/api/admin/exams/save", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            id: currentEditingExam.id,
                            duration_minutes: currentEditingExam.duration_minutes || 60,
                            total_questions: currentQuestionsDraft.length,
                            total_marks: totalMarks,
                            questions: currentQuestionsDraft
                        })
                    });
                    if (res.ok) {
                        showToast(`Questions approved and saved for ${currentEditingExam.title}!`);
                        await loadExams();
                    } else {
                        const err = await res.json();
                        showToast("Error saving questions: " + (err.error || "Save failed"), true);
                        return;
                    }
                } catch (e) {
                    showToast("Error saving questions: " + e.message, true);
                    return;
                }
            }

            setModal($("#review50QuestionsModal"), false);
            updateQuestionsDraftUI();
            showToast(`${currentQuestionsDraft.length} Questions approved and ready for examination.`);
        });
    }

    // Save & Publish Examination Submit Handler
    const examCreateForm = $("#examCreateForm");
    if (examCreateForm) {
        examCreateForm.addEventListener("submit", async e => {
            e.preventDefault();
            syncDraftFromDOM();

            const id = $("#examFormId")?.value.trim();
            const title = $("#examFormTitle")?.value.trim();
            const date = $("#examFormDate")?.value.trim();
            const time = $("#examFormTime")?.value.trim();
            const description = $("#examFormDesc")?.value.trim();
            const duration = Math.max(1, Math.min(600, parseInt($("#examFormDuration")?.value, 10) || 60));

            const targetQuestionCount = parseInt($("#examConfigQuestionCount")?.value, 10) || currentQuestionsDraft.length;
            const targetTotalMarks = parseFloat($("#examConfigTotalMarks")?.value) || currentQuestionsDraft.reduce((s, q) => s + (Number(q.marks) || 1), 0);
            const marksMode = $("#examMarksModeSelect")?.value || "equal";
            const marksPerQ = parseFloat($("#examConfigMarksPerQ")?.value) || (targetQuestionCount > 0 ? Math.round((targetTotalMarks / targetQuestionCount) * 100) / 100 : 1);
            const isCompulsory = $("#examCompulsorySelect")?.value !== "false";
            const negMarking = Boolean($("#examNegativeMarkingToggle")?.checked);
            const negValue = parseFloat($("#examNegativeMarkValue")?.value) || 0.25;

            const enabledTypes = [];
            if ($("#examTypeMcq")?.checked) enabledTypes.push("mcq");
            if ($("#examTypeMsq")?.checked) enabledTypes.push("msq");
            if (enabledTypes.length === 0) enabledTypes.push("mcq");

            if (!title || !date || !time) {
                $("#examCreateStatus").textContent = "Please fill in Examination Title, Date, and Start Time.";
                showToast("Please fill in Examination Title, Date, and Start Time.", true);
                return;
            }

            const val = validateQuestionsDraft(currentQuestionsDraft);
            if (!val.valid) {
                $("#examCreateStatus").textContent = val.message;
                showToast(val.message, true);
                return;
            }

            // Distribute equal marks if in equal mode
            if (marksMode === "equal") {
                currentQuestionsDraft.forEach(q => { q.marks = marksPerQ; });
            }

            $("#examCreateStatus").textContent = "Scheduling examination and validating questions...";

            const questionsToSave = currentQuestionsDraft;
            const endpoint = id ? "/api/admin/exams/save" : "/api/admin/exams/create";
            try {
                const res = await adminFetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id,
                        title,
                        scheduled_date: date,
                        scheduled_time: time,
                        description,
                        duration_minutes: duration,
                        total_questions: targetQuestionCount,
                        total_marks: targetTotalMarks,
                        marks_mode: marksMode,
                        marks_per_question: marksPerQ,
                        is_compulsory: isCompulsory,
                        negative_marking: negMarking,
                        negative_mark_value: negValue,
                        question_types: enabledTypes,
                        status: "published",
                        questions: questionsToSave
                    })
                });

                if (res.ok) {
                    setModal($("#examCreateModal"), false);
                    setModal($("#examPublishPreviewModal"), false);
                    showToast(`Examination '${title}' scheduled & published successfully!`);
                    await loadExams();
                } else {
                    const err = await res.json();
                    $("#examCreateStatus").textContent = err.error || "Failed to save examination.";
                    showToast("Failed to save: " + (err.error || "Validation error"), true);
                }
            } catch (err) {
                $("#examCreateStatus").textContent = "Network error: " + err.message;
                showToast("Network error: " + err.message, true);
            }
        });
    }

    // Pre-Publish Examination Preview Modal Controller
    const openExamPublishPreviewBtn = $("#openExamPublishPreviewBtn");
    const examPublishPreviewModal = $("#examPublishPreviewModal");
    const confirmPublishFromPreviewBtn = $("#confirmPublishFromPreviewBtn");

    if (openExamPublishPreviewBtn && examPublishPreviewModal) {
        openExamPublishPreviewBtn.addEventListener("click", () => {
            syncDraftFromDOM();
            const title = $("#examFormTitle")?.value.trim() || "Untitled Examination";
            const date = $("#examFormDate")?.value || "—";
            const time = $("#examFormTime")?.value || "—";
            const duration = $("#examFormDuration")?.value || "60";
            const targetQ = parseInt($("#examConfigQuestionCount")?.value, 10) || currentQuestionsDraft.length;
            const targetM = parseFloat($("#examConfigTotalMarks")?.value) || currentQuestionsDraft.reduce((s,q) => s + (Number(q.marks) || 1), 0);
            const mode = $("#examMarksModeSelect")?.value || "equal";
            const isCompulsory = $("#examCompulsorySelect")?.value !== "false";
            const negMarking = Boolean($("#examNegativeMarkingToggle")?.checked);
            const negValue = $("#examNegativeMarkValue")?.value || "0.25";

            const types = [];
            if ($("#examTypeMcq")?.checked) types.push("MCQ (Single Choice)");
            if ($("#examTypeMsq")?.checked) types.push("MSQ (Multiple Select)");

            if ($("#previewMetaTitle")) $("#previewMetaTitle").textContent = title;
            if ($("#previewMetaSchedule")) $("#previewMetaSchedule").textContent = `${date} at ${time} IST (${duration} Minutes)`;
            if ($("#previewMetaQuestions")) $("#previewMetaQuestions").textContent = `${targetQ} Questions (${currentQuestionsDraft.length} in draft)`;
            if ($("#previewMetaMarks")) $("#previewMetaMarks").textContent = `${targetM} Marks`;
            if ($("#previewMetaDuration")) $("#previewMetaDuration").textContent = `${duration} Minutes`;
            if ($("#previewMetaNegative")) $("#previewMetaNegative").textContent = negMarking ? `Enabled (-${negValue} per wrong answer)` : "Disabled (No negative marking)";
            if ($("#previewMetaMode")) $("#previewMetaMode").textContent = mode === "equal" ? `Equal marks (${(targetM/targetQ).toFixed(2)} marks per question)` : "Variable individual marks";
            if ($("#previewMetaTypes")) $("#previewMetaTypes").textContent = types.join(", ") || "MCQ";
            if ($("#previewMetaCompulsory")) $("#previewMetaCompulsory").textContent = isCompulsory ? "All questions are compulsory" : "Optional / Selected questions";

            const valBanner = $("#previewValidationStatusBox");
            const isValid = validateAndRenderConfigBanner();
            if (valBanner) {
                if (isValid) {
                    valBanner.style.background = "#f0fdf4";
                    valBanner.style.color = "#166534";
                    valBanner.style.border = "1px solid #86efac";
                    valBanner.innerHTML = "✓ All examination parameters and questions are validated. Examination is ready for publishing.";
                } else {
                    valBanner.style.background = "#fee2e2";
                    valBanner.style.color = "#991b1b";
                    valBanner.style.border = "1px solid #f87171";
                    valBanner.innerHTML = "⚠️ Configuration or questions have discrepancies. Please review alerts before publishing.";
                }
            }

            const tbody = $("#previewQuestionsTbody");
            if (tbody) {
                tbody.innerHTML = currentQuestionsDraft.map((q, idx) => {
                    const qNum = idx + 1;
                    const type = (q.type || "mcq").toUpperCase();
                    const textSnippet = escapeHtml((q.statement || q.question_text || "").substring(0, 75));
                    const key = escapeHtml(Array.isArray(q.correct_answers) ? q.correct_answers.join(",") : (q.correct_answer || q.key || "A"));
                    const marks = q.marks !== undefined ? q.marks : 1;
                    return `
                        <tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 12px; font-weight:700;">${qNum}</td>
                            <td style="padding:6px 12px;"><span class="badge-pill badge-gold" style="font-size:10px;">${type}</span></td>
                            <td style="padding:6px 12px; color:#334155;">${textSnippet}...</td>
                            <td style="padding:6px 12px; text-align:center; font-weight:700; font-family:'Space Grotesk',monospace; color:#0f172a;">${key}</td>
                            <td style="padding:6px 12px; text-align:right; font-weight:600;">${marks}</td>
                        </tr>
                    `;
                }).join("");
            }

            setModal(examPublishPreviewModal, true);
        });

        if (confirmPublishFromPreviewBtn) {
            confirmPublishFromPreviewBtn.addEventListener("click", () => {
                const form = $("#examCreateForm");
                if (form) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
            });
        }
    }

    // Safe Delete Modal Logic
    let deleteTargetExamId = null;
    let deleteTargetExamTitle = "";

    function openSafeDeleteModal(examId) {
        const modal = $("#safeDeleteExamModal");
        if (!modal) return;
        const exam = allExamsList.find(e => e.id === examId);
        if (!exam) return;

        deleteTargetExamId = exam.id;
        deleteTargetExamTitle = exam.title || exam.name || exam.id;

        if ($("#deleteTargetExamName")) $("#deleteTargetExamName").textContent = deleteTargetExamTitle;
        if ($("#deleteMatchHint")) $("#deleteMatchHint").textContent = deleteTargetExamTitle;
        if ($("#deleteExamConfirmInput")) {
            $("#deleteExamConfirmInput").value = "";
            $("#deleteExamConfirmInput").placeholder = `Type '${deleteTargetExamTitle}' or 'CONFIRM DELETE'`;
        }
        if ($("#confirmDeleteExamBtn")) {
            $("#confirmDeleteExamBtn").disabled = true;
            $("#confirmDeleteExamBtn").style.opacity = "0.5";
            $("#confirmDeleteExamBtn").style.cursor = "not-allowed";
        }
        if ($("#deleteExamStatus")) $("#deleteExamStatus").textContent = "";

        setModal(modal, true);
    }

    const deleteExamConfirmInput = $("#deleteExamConfirmInput");
    const confirmDeleteExamBtn = $("#confirmDeleteExamBtn");

    if (deleteExamConfirmInput && confirmDeleteExamBtn) {
        deleteExamConfirmInput.addEventListener("input", () => {
            const val = deleteExamConfirmInput.value.trim().toLowerCase();
            const targetTitle = (deleteTargetExamTitle || "").toLowerCase();
            const isMatch = (val === "confirm delete" || (val.length > 3 && val === targetTitle));

            confirmDeleteExamBtn.disabled = !isMatch;
            confirmDeleteExamBtn.style.opacity = isMatch ? "1" : "0.5";
            confirmDeleteExamBtn.style.cursor = isMatch ? "pointer" : "not-allowed";
        });

        confirmDeleteExamBtn.addEventListener("click", async () => {
            if (!deleteTargetExamId) return;
            const phrase = deleteExamConfirmInput.value.trim();
            const statusEl = $("#deleteExamStatus");
            if (statusEl) statusEl.textContent = "Deleting examination...";

            try {
                const res = await adminFetch("/api/admin/exams/delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        examId: deleteTargetExamId,
                        confirmationPhrase: phrase
                    })
                });

                if (res.ok) {
                    setModal($("#safeDeleteExamModal"), false);
                    showToast(`Examination '${deleteTargetExamTitle}' permanently deleted.`);
                    await loadExams();
                } else {
                    const err = await res.json();
                    if (statusEl) statusEl.textContent = err.error || "Deletion rejected.";
                }
            } catch (err) {
                if (statusEl) statusEl.textContent = "Network error: " + err.message;
            }
        });
    }

    // Clean Legacy Courses Modal Logic
    const openCleanupCoursesBtn = $("#openCleanupCoursesBtn");
    const cleanupCoursesModal = $("#cleanupCoursesModal");
    const cleanupCoursesConfirmInput = $("#cleanupCoursesConfirmInput");
    const confirmCleanupCoursesBtn = $("#confirmCleanupCoursesBtn");

    if (openCleanupCoursesBtn && cleanupCoursesModal) {
        openCleanupCoursesBtn.addEventListener("click", () => {
            if (cleanupCoursesConfirmInput) cleanupCoursesConfirmInput.value = "";
            if (confirmCleanupCoursesBtn) {
                confirmCleanupCoursesBtn.disabled = true;
                confirmCleanupCoursesBtn.style.opacity = "0.5";
                confirmCleanupCoursesBtn.style.cursor = "not-allowed";
            }
            if ($("#cleanupCoursesStatus")) $("#cleanupCoursesStatus").textContent = "";
            setModal(cleanupCoursesModal, true);
        });
    }

    if (cleanupCoursesConfirmInput && confirmCleanupCoursesBtn) {
        cleanupCoursesConfirmInput.addEventListener("input", () => {
            const isMatch = (cleanupCoursesConfirmInput.value.trim() === "DELETE LEGACY COURSES");
            confirmCleanupCoursesBtn.disabled = !isMatch;
            confirmCleanupCoursesBtn.style.opacity = isMatch ? "1" : "0.5";
            confirmCleanupCoursesBtn.style.cursor = isMatch ? "pointer" : "not-allowed";
        });

        confirmCleanupCoursesBtn.addEventListener("click", async () => {
            const phrase = cleanupCoursesConfirmInput.value.trim();
            const statusEl = $("#cleanupCoursesStatus");
            if (statusEl) statusEl.textContent = "Purging legacy courses...";

            try {
                const res = await adminFetch("/api/admin/legacy/cleanup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirmationPhrase: phrase })
                });

                if (res.ok) {
                    setModal(cleanupCoursesModal, false);
                    showToast("Legacy courses purged! Examination-Only Platform active.");
                    await loadExams();
                } else {
                    const err = await res.json();
                    if (statusEl) statusEl.textContent = err.error || "Purge rejected.";
                }
            } catch (e) {
                if (statusEl) statusEl.textContent = "Network error: " + e.message;
            }
        });
    }

    // =========================================================================
    // 6. MODULE 3: STUDENTS LIST (ROLL NUMBER PRIMARY UNIQUE ID)
    // =========================================================================
    let allStudents = [];

    async function loadStudents() {
        try {
            const res = await adminFetch("/api/admin/students");
            if (res.ok) {
                const data = await res.json();
                allStudents = data.students || [];
            }
        } catch (err) {
            console.warn("[STUDENTS-FETCH-ERROR]", err.message);
        }

        renderStudentsTable();
    }

    function renderStudentsTable() {
        const tbody = $("#studentsTableBody");
        if (!tbody) return;

        const searchVal = ($("#studentSearchInput")?.value || "").trim().toLowerCase();
        const deptVal = ($("#studentDeptFilter")?.value || "").trim();
        const yearVal = ($("#studentYearFilter")?.value || "").trim();
        const statusVal = ($("#studentStatusFilter")?.value || "").trim();

        const filtered = allStudents.filter(s => {
            const roll = (s.roll_number || "").toLowerCase();
            const name = (s.name || s.full_name || "").toLowerCase();
            const email = (s.email || "").toLowerCase();
            const searchMatch = !searchVal || roll.includes(searchVal) || name.includes(searchVal) || email.includes(searchVal);
            const deptMatch = !deptVal || (s.department || s.branch) === deptVal;
            const yearMatch = matchesAcademicYear(s.academic_year || s.batch, yearVal);
            const statusMatch = !statusVal || (s.status || "active") === statusVal;
            return searchMatch && deptMatch && yearMatch && statusMatch;
        });

        if ($("#studentsCountChip")) {
            $("#studentsCountChip").textContent = `${allStudents.length} Registered Student${allStudents.length === 1 ? '' : 's'}`;
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No student records match the active search or filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(s => {
            const roll = (s.roll_number || "").toUpperCase();
            const status = s.status || "active";
            const isActive = status === "active";
            const isSuspended = status === "suspended";
            const isDeleted = status === "deleted";

            let statusBadge = `<span class="badge-active">Active</span>`;
            if (isSuspended) {
                statusBadge = `<span class="badge-suspended" style="background:#fffbeb; color:#b45309; border-color:#fde68a;">Suspended</span>`;
            } else if (isDeleted) {
                statusBadge = `<span class="badge-suspended" style="background:#f1f5f9; color:#64748b; border-color:#cbd5e1;">Deleted</span>`;
            }

            let actionButtons = "";
            if (isActive) {
                actionButtons = `
                    <button class="button-secondary btn-sm" data-suspend-student="${escapeHtml(roll)}" style="color:#b45309; border-color:#fde68a; background:#fffbeb;" title="Suspend student login & exam access">
                        Suspend
                    </button>
                    <button class="button-secondary btn-sm" data-delete-student="${escapeHtml(roll)}" style="color:#dc2626; border-color:#fecaca; background:#fef2f2;" title="Permanently delete student account">
                        Delete
                    </button>
                `;
            } else if (isSuspended) {
                actionButtons = `
                    <button class="button-secondary btn-sm" data-activate-student="${escapeHtml(roll)}" style="color:#15803d; border-color:#bbf7d0; background:#f0fdf4;" title="Reactivate student account">
                        Activate
                    </button>
                    <button class="button-secondary btn-sm" data-delete-student="${escapeHtml(roll)}" style="color:#dc2626; border-color:#fecaca; background:#fef2f2;" title="Permanently delete student account">
                        Delete
                    </button>
                `;
            } else {
                actionButtons = `<span style="font-size:11px; color:#94a3b8; font-weight:600;">Access Revoked</span>`;
            }

            return `
                <tr>
                    <td><strong>${escapeHtml(roll)}</strong></td>
                    <td>${escapeHtml(s.name || s.full_name)}</td>
                    <td><a href="mailto:${escapeHtml(s.email)}" style="color:#8c6914; text-decoration:none;">${escapeHtml(s.email)}</a></td>
                    <td>${escapeHtml(s.department || s.branch || "Information Technology")}</td>
                    <td>${escapeHtml(s.academic_year || s.batch || "3rd Year B.Tech")}</td>
                    <td>${escapeHtml(formatDate(s.created_at))}</td>
                    <td>${statusBadge}</td>
                    <td class="actions-column">
                        <button class="button-secondary btn-sm" data-edit-student="${escapeHtml(roll)}" title="Edit Student Record">
                            <svg class="icon"><use href="#icon-edit"></use></svg> Edit
                        </button>
                        ${actionButtons}
                    </td>
                </tr>
            `;
        }).join("");

        $$("[data-edit-student]").forEach(btn => {
            btn.addEventListener("click", () => {
                const roll = btn.getAttribute("data-edit-student");
                openStudentModal(roll);
            });
        });

        $$("[data-suspend-student]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const roll = btn.getAttribute("data-suspend-student");
                if (!confirm(`Are you sure you want to SUSPEND student ${roll}? Suspended students cannot log in or attempt examinations.`)) return;
                try {
                    const res = await adminFetch("/api/admin/students/suspend", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ rollNumber: roll })
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`Student ${roll} has been suspended.`);
                        await loadStudents();
                    } else {
                        showToast(data.error || "Failed to suspend student.", true);
                    }
                } catch (err) {
                    showToast("Error: " + err.message, true);
                }
            });
        });

        $$("[data-activate-student]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const roll = btn.getAttribute("data-activate-student");
                try {
                    const res = await adminFetch("/api/admin/students/activate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ rollNumber: roll })
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`Student ${roll} has been reactivated.`);
                        await loadStudents();
                    } else {
                        showToast(data.error || "Failed to activate student.", true);
                    }
                } catch (err) {
                    showToast("Error: " + err.message, true);
                }
            });
        });

        $$("[data-delete-student]").forEach(btn => {
            btn.addEventListener("click", () => {
                const roll = btn.getAttribute("data-delete-student");
                openDeleteStudentModal(roll);
            });
        });
    }

    ["#studentSearchInput", "#studentDeptFilter", "#studentYearFilter", "#studentStatusFilter"].forEach(sel => {
        const el = $(sel);
        if (el) {
            el.addEventListener("input", renderStudentsTable);
            el.addEventListener("change", renderStudentsTable);
        }
    });

    const exportStudentsExcelBtn = $("#exportStudentsExcelBtn");
    if (exportStudentsExcelBtn) {
        exportStudentsExcelBtn.addEventListener("click", async () => {
            try {
                const res = await adminFetch("/api/admin/students/export");
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.students && data.students.length > 0) {
                        exportStudentsRoster(data.students);
                        return;
                    }
                }
            } catch (e) {
                console.warn("[EXPORT-STUDENTS-FETCH]", e);
            }
            exportStudentsRoster(allStudents);
        });
    }

    const openAddStudentBtn = $("#openAddStudentBtn");
    if (openAddStudentBtn) {
        openAddStudentBtn.addEventListener("click", () => openStudentModal(null));
    }

    function openStudentModal(rollNumber) {
        const modal = $("#studentModal");
        if (!modal) return;

        const isEdit = Boolean(rollNumber);
        const titleEl = $("#studentModalTitle");
        if (titleEl) titleEl.textContent = isEdit ? "Edit Student Details" : "Add Student Record";

        const student = isEdit ? allStudents.find(s => s.roll_number.toUpperCase() === rollNumber.toUpperCase()) : null;

        $("#studentFormOriginalRoll").value = student ? student.roll_number : "";
        $("#studentFormRoll").value = student ? student.roll_number : "";
        $("#studentFormName").value = student ? (student.name || student.full_name) : "";
        $("#studentFormEmail").value = student ? student.email : "";
        $("#studentFormBranch").value = student ? (student.department || student.branch) : "Information Technology";
        $("#studentFormBatch").value = student ? (student.academic_year || student.batch) : "3rd Year B.Tech";
        $("#studentFormStatus").textContent = "";

        setModal(modal, true);
    }

    const studentForm = $("#studentForm");
    if (studentForm) {
        studentForm.addEventListener("submit", async e => {
            e.preventDefault();
            const originalRoll = $("#studentFormOriginalRoll").value.trim().toUpperCase();
            const roll = $("#studentFormRoll").value.trim().toUpperCase();
            const name = $("#studentFormName").value.trim();
            const email = $("#studentFormEmail").value.trim().toLowerCase();
            const branch = $("#studentFormBranch").value.trim();
            const batch = $("#studentFormBatch").value.trim();
            const isEdit = Boolean(originalRoll);

            if (!roll || !name || !email) {
                $("#studentFormStatus").textContent = "Please fill in all required fields.";
                return;
            }

            const duplicate = allStudents.find(s => s.roll_number.toUpperCase() === roll && (!isEdit || s.roll_number.toUpperCase() !== originalRoll));
            if (duplicate) {
                $("#studentFormStatus").textContent = `Student with Roll Number '${roll}' already exists. Roll numbers must be unique.`;
                return;
            }

            $("#studentFormStatus").textContent = "Saving student record...";

            try {
                const res = await adminFetch("/api/admin/students/save", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        roll_number: roll,
                        name,
                        email,
                        department: branch,
                        academic_year: batch,
                        isEdit,
                        originalRoll
                    })
                });

                if (res.ok) {
                    setModal($("#studentModal"), false);
                    showToast(`Student record for ${roll} saved!`);
                    await loadStudents();
                } else {
                    const err = await res.json();
                    $("#studentFormStatus").textContent = err.error || "Failed to save student.";
                }
            } catch (err) {
                $("#studentFormStatus").textContent = "Network error: " + err.message;
            }
        });
    }

    // Permanent Student Deletion Logic
    let delTargetRoll = null;

    async function openDeleteStudentModal(roll) {
        delTargetRoll = roll;
        const modal = $("#deleteStudentModal");
        if (!modal) return;

        if ($("#delStudentRoll")) $("#delStudentRoll").textContent = roll;
        if ($("#delStudentRollHint")) $("#delStudentRollHint").textContent = roll;
        if ($("#delStudentName")) $("#delStudentName").textContent = "Loading...";
        if ($("#delStudentAttempts")) $("#delStudentAttempts").textContent = "...";
        if ($("#delStudentResults")) $("#delStudentResults").textContent = "...";

        const input = $("#deleteStudentConfirmInput");
        if (input) {
            input.value = "";
            input.placeholder = `Type '${roll}' to confirm deletion`;
        }

        const confirmBtn = $("#confirmDeleteStudentBtn");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = "0.5";
            confirmBtn.style.cursor = "not-allowed";
        }
        if ($("#deleteStudentStatus")) $("#deleteStudentStatus").textContent = "";

        setModal(modal, true);

        try {
            const res = await adminFetch(`/api/admin/students/details?roll=${encodeURIComponent(roll)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.student) {
                    if ($("#delStudentName")) $("#delStudentName").textContent = data.student.name || roll;
                    if ($("#delStudentAttempts")) $("#delStudentAttempts").textContent = data.student.attemptsCount || 0;
                    if ($("#delStudentResults")) $("#delStudentResults").textContent = data.student.resultsCount || 0;
                }
            }
        } catch (e) {
            console.warn("Failed to fetch student details for deletion modal:", e);
        }
    }

    const deleteStudentConfirmInput = $("#deleteStudentConfirmInput");
    const confirmDeleteStudentBtn = $("#confirmDeleteStudentBtn");

    if (deleteStudentConfirmInput && confirmDeleteStudentBtn) {
        deleteStudentConfirmInput.addEventListener("input", () => {
            const isMatch = (deleteStudentConfirmInput.value.trim().toUpperCase() === (delTargetRoll || "").toUpperCase());
            confirmDeleteStudentBtn.disabled = !isMatch;
            confirmDeleteStudentBtn.style.opacity = isMatch ? "1" : "0.5";
            confirmDeleteStudentBtn.style.cursor = isMatch ? "pointer" : "not-allowed";
        });

        confirmDeleteStudentBtn.addEventListener("click", async () => {
            if (!delTargetRoll) return;
            const statusEl = $("#deleteStudentStatus");
            if (statusEl) statusEl.textContent = "Permanently deleting student account...";

            try {
                const res = await adminFetch("/api/admin/students/delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        rollNumber: delTargetRoll,
                        confirmationRoll: deleteStudentConfirmInput.value.trim().toUpperCase()
                    })
                });

                const data = await res.json();
                if (res.ok) {
                    setModal($("#deleteStudentModal"), false);
                    showToast(data.message || `Student ${delTargetRoll} account deleted.`);
                    await loadStudents();
                } else {
                    if (statusEl) statusEl.textContent = data.error || "Deletion rejected.";
                }
            } catch (err) {
                if (statusEl) statusEl.textContent = "Network error: " + err.message;
            }
        });
    }

    // =========================================================================
    // 7. MODULE 4: LIVE EXAMINATION MONITORING (RUNNING EXAMINATIONS)
    // =========================================================================
    let activeLiveExam = null;
    let activeLiveCandidates = [];

    async function loadLiveMonitoring(selectedExamId = null) {
        try {
            const query = selectedExamId ? `&examId=${encodeURIComponent(selectedExamId)}` : "";
            const res = await adminFetch(`/api/admin/exams/monitoring?mode=live${query}`);
            if (!res.ok) {
                throw new Error(`Failed to load live monitoring: ${res.status}`);
            }
            const data = await res.json();
            const liveExams = data.liveExams || [];
            const select = $("#monitorLiveExamSelect");
            const banner = $("#noLiveExamsBanner");

            if (select) {
                if (liveExams.length === 0) {
                    select.innerHTML = `<option value="">No live examinations active</option>`;
                } else {
                    select.innerHTML = liveExams.map(e => 
                        `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title || e.name)}</option>`
                    ).join("");
                    if (data.exam && data.exam.id) {
                        select.value = data.exam.id;
                    }
                }
            }

            if (banner) {
                banner.style.display = (liveExams.length === 0) ? "block" : "none";
            }

            activeLiveExam = data.exam;
            activeLiveCandidates = data.candidates || [];

            if (data.counts) {
                if ($("#statLiveEligible")) $("#statLiveEligible").textContent = data.counts.totalEligible || data.counts.totalAssigned || 0;
                if ($("#statLiveInProgress")) $("#statLiveInProgress").textContent = data.counts.inProgress || 0;
                if ($("#statLiveSubmitted")) $("#statLiveSubmitted").textContent = data.counts.submitted || 0;
                if ($("#statLiveAbsent")) $("#statLiveAbsent").textContent = data.counts.absent || data.counts.notStarted || 0;
            } else {
                if ($("#statLiveEligible")) $("#statLiveEligible").textContent = "0";
                if ($("#statLiveInProgress")) $("#statLiveInProgress").textContent = "0";
                if ($("#statLiveSubmitted")) $("#statLiveSubmitted").textContent = "0";
                if ($("#statLiveAbsent")) $("#statLiveAbsent").textContent = "0";
            }

            renderLiveMonitoringTable();
        } catch (err) {
            console.warn("[LIVE-MONITOR-FETCH-ERROR]", err.message);
            renderLiveMonitoringTable();
        }
    }

    const monitorLiveExamSelect = $("#monitorLiveExamSelect");
    if (monitorLiveExamSelect) {
        monitorLiveExamSelect.addEventListener("change", () => {
            loadLiveMonitoring(monitorLiveExamSelect.value);
        });
    }

    function renderLiveMonitoringTable() {
        const tbody = $("#monitorLiveTableBody");
        if (!tbody) return;

        if (!activeLiveExam || activeLiveCandidates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No running examinations or live candidates available at this time.</td></tr>`;
            return;
        }

        const searchVal = ($("#monitorLiveSearch")?.value || "").trim().toLowerCase();
        const deptVal = ($("#monitorLiveDeptFilter")?.value || "").trim();
        const statusVal = ($("#monitorLiveStatusFilter")?.value || "").trim();

        const filtered = activeLiveCandidates.filter(c => {
            const roll = (c.roll_number || c.rollNumber || "").toLowerCase();
            const name = (c.name || c.studentName || "").toLowerCase();
            const matchSearch = !searchVal || roll.includes(searchVal) || name.includes(searchVal);
            const matchDept = !deptVal || (c.branch || c.department) === deptVal;
            const matchStatus = !statusVal || c.status === statusVal || c.attemptStatus === statusVal;
            return matchSearch && matchDept && matchStatus;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No live candidates match active search or filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(c => {
            let statusBadge = "badge-blue";
            const st = c.status || c.attemptStatus || "Not Started";
            if (st === "Submitted") statusBadge = "badge-green";
            else if (st === "Auto Submitted") statusBadge = "badge-gold";
            else if (st === "Absent") statusBadge = "badge-suspended";
            else if (st === "Not Started") statusBadge = "badge-purple";
            else if (st === "In Progress") statusBadge = "badge-blue";
            else if (st.includes("Suspended")) statusBadge = "badge-suspended";

            const rollNum = parseInt((c.roll_number || "").replace(/\D/g, ""), 10) || 1;
            const setLetter = String.fromCharCode(65 + ((rollNum - 1) % 10)); // Set A through Set J

            return `
                <tr>
                    <td><strong>${escapeHtml(c.roll_number || c.rollNumber)}</strong></td>
                    <td>${escapeHtml(c.studentName || c.name || "—")}</td>
                    <td>${escapeHtml(c.branch || c.department || "Information Technology")}</td>
                    <td>${escapeHtml(c.batch || c.academic_year || "3rd Year B.Tech")}</td>
                    <td><span class="count-chip" style="font-weight:700;">Set ${setLetter}</span></td>
                    <td><span style="color:#16a34a; font-weight:600;">0</span></td>
                    <td>${c.started_at ? escapeHtml(formatDateTime(c.started_at)) : "—"}</td>
                    <td><span class="badge-pill ${statusBadge}">${escapeHtml(st)}</span></td>
                </tr>
            `;
        }).join("");
    }

    ["#monitorLiveSearch", "#monitorLiveDeptFilter", "#monitorLiveStatusFilter"].forEach(sel => {
        const el = $(sel);
        if (el) {
            el.addEventListener("input", renderLiveMonitoringTable);
            el.addEventListener("change", renderLiveMonitoringTable);
        }
    });

    const exportLiveMonitoringExcelBtn = $("#exportLiveMonitoringExcelBtn");
    if (exportLiveMonitoringExcelBtn) {
        exportLiveMonitoringExcelBtn.addEventListener("click", () => {
            if (!activeLiveExam) {
                showToast("No active live examination to export.", true);
                return;
            }
            exportExamResultsRoster(activeLiveExam.title || "Live_Examination", activeLiveCandidates, false);
        });
    }

    // =========================================================================
    // 8. MODULE 5: COMPLETED EXAMINATIONS & RESULTS (HISTORICAL ARCHIVES)
    // =========================================================================
    let activeCompletedExam = null;
    let activeCompletedCandidates = [];

    async function loadCompletedExams(selectedExamId = null) {
        try {
            const query = selectedExamId ? `&examId=${encodeURIComponent(selectedExamId)}` : "";
            const res = await adminFetch(`/api/admin/exams/monitoring?mode=completed${query}`);
            if (!res.ok) {
                throw new Error(`Failed to load completed examinations: ${res.status}`);
            }
            const data = await res.json();
            const completedExams = data.completedExams || [];
            const select = $("#completedExamSelect");

            if (select) {
                if (completedExams.length === 0) {
                    select.innerHTML = `<option value="">No completed examinations available</option>`;
                } else {
                    select.innerHTML = completedExams.map(e => 
                        `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title || e.name)}</option>`
                    ).join("");
                    if (data.exam && data.exam.id) {
                        select.value = data.exam.id;
                    }
                }
            }

            activeCompletedExam = data.exam;
            activeCompletedCandidates = data.candidates || [];

            // Compute statistics
            const attempted = activeCompletedCandidates.filter(c => 
                c.status === "Submitted" || c.status === "Auto Submitted" || (c.marksObtained !== null && c.marksObtained !== undefined)
            );
            const maxExamScore = (activeCompletedExam && activeCompletedExam.total_marks) || 50;
            const passThreshold = maxExamScore * 0.40;
            const passed = attempted.filter(c => c.passed === true || (c.marksObtained >= passThreshold));
            const failed = attempted.filter(c => c.passed === false || (c.marksObtained !== null && c.marksObtained < passThreshold));
            const totalScore = attempted.reduce((sum, c) => sum + (Number(c.marksObtained || c.score) || 0), 0);
            const avgScore = attempted.length > 0 ? (totalScore / attempted.length).toFixed(1) : "0";

            if ($("#statCompAttempted")) $("#statCompAttempted").textContent = attempted.length;
            if ($("#statCompPassed")) $("#statCompPassed").textContent = passed.length;
            if ($("#statCompFailed")) $("#statCompFailed").textContent = failed.length;
            if ($("#statCompAvgScore")) $("#statCompAvgScore").textContent = `${avgScore} / ${maxExamScore}`;

            renderCompletedExamsTable();
        } catch (err) {
            console.warn("[COMPLETED-EXAMS-FETCH-ERROR]", err.message);
            renderCompletedExamsTable();
        }
    }

    const completedExamSelect = $("#completedExamSelect");
    if (completedExamSelect) {
        completedExamSelect.addEventListener("change", () => {
            loadCompletedExams(completedExamSelect.value);
        });
    }

    function renderCompletedExamsTable() {
        const tbody = $("#completedTableBody");
        if (!tbody) return;

        if (!activeCompletedExam || activeCompletedCandidates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="13" class="table-empty">No completed examination selected or no results found.</td></tr>`;
            return;
        }

        const searchVal = ($("#completedCandidateSearch")?.value || "").trim().toLowerCase();
        const deptVal = ($("#completedDeptFilter")?.value || "").trim();
        const statusVal = ($("#completedStatusFilter")?.value || "").trim();
        const attemptedOnly = $("#completedAttemptedOnly") ? $("#completedAttemptedOnly").checked : false;

        const filtered = activeCompletedCandidates.filter(c => {
            const roll = (c.roll_number || c.rollNumber || "").toLowerCase();
            const name = (c.name || c.studentName || "").toLowerCase();
            const matchSearch = !searchVal || roll.includes(searchVal) || name.includes(searchVal);
            const matchDept = !deptVal || (c.branch || c.department) === deptVal;
            const isAttempted = (c.status === "Submitted" || c.status === "Auto Submitted" || c.marksObtained !== null);
            if (attemptedOnly && !isAttempted) return false;

            if (statusVal === "Pass") {
                if (c.passed !== true && (c.marksObtained === null || c.marksObtained < 20)) return false;
            } else if (statusVal === "Fail") {
                if (!isAttempted || c.passed === true || (c.marksObtained !== null && c.marksObtained >= 20)) return false;
            }
            return matchSearch && matchDept;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="13" class="table-empty">No candidate records match active search or filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map((c, index) => {
            const sNo = index + 1;
            const roll = c.roll_number || c.rollNumber || "—";
            const name = c.studentName || c.name || "—";
            const email = c.email || "—";
            const branch = c.branch || c.department || "Information Technology";
            const academicYear = c.academic_year || "2nd Year B.Tech (2026-27)";
            const batch = c.batch || "2024-2028";
            const marks = (c.marksObtained !== null && c.marksObtained !== undefined) ? c.marksObtained : (c.score !== null && c.score !== undefined ? c.score : "—");
            const totalMarks = marks !== "—" ? "50" : "—";
            const pct = c.percentage !== null && c.percentage !== undefined ? `${c.percentage}%` : (marks !== "—" ? `${Math.round((marks/50)*100)}%` : "—");

            let statusBadge = "badge-blue";
            const st = c.status || c.attemptStatus || "Not Started";
            if (st === "Submitted") statusBadge = "badge-green";
            else if (st === "Auto Submitted") statusBadge = "badge-gold";
            else if (st === "Absent") statusBadge = "badge-suspended";

            return `
                <tr>
                    <td>${sNo}</td>
                    <td><strong>${escapeHtml(roll)}</strong></td>
                    <td>${escapeHtml(name)}</td>
                    <td>${escapeHtml(email)}</td>
                    <td>${escapeHtml(branch)}</td>
                    <td>${escapeHtml(academicYear)}</td>
                    <td>${escapeHtml(batch)}</td>
                    <td><strong>${marks}</strong></td>
                    <td>${totalMarks}</td>
                    <td>${pct}</td>
                    <td><span class="badge-pill ${statusBadge}">${escapeHtml(st)}</span></td>
                    <td>${c.started_at ? escapeHtml(formatDateTime(c.started_at)) : "—"}</td>
                    <td>${c.submitted_at ? escapeHtml(formatDateTime(c.submitted_at)) : "—"}</td>
                </tr>
            `;
        }).join("");
    }

    ["#completedCandidateSearch", "#completedDeptFilter", "#completedStatusFilter", "#completedAttemptedOnly"].forEach(sel => {
        const el = $(sel);
        if (el) {
            el.addEventListener("input", renderCompletedExamsTable);
            el.addEventListener("change", renderCompletedExamsTable);
        }
    });

    const exportCompletedExcelBtn = $("#exportCompletedExcelBtn");
    if (exportCompletedExcelBtn) {
        exportCompletedExcelBtn.addEventListener("click", () => {
            if (!activeCompletedExam) {
                showToast("No completed examination selected to export.", true);
                return;
            }
            const attemptedOnly = $("#completedAttemptedOnly") ? $("#completedAttemptedOnly").checked : false;
            exportExamResultsRoster(activeCompletedExam.title || "Completed_Exam_Results", activeCompletedCandidates, attemptedOnly);
        });
    }

    // =========================================================================
    // 9. MODULE 6: STUDENT REVALIDATION REQUESTS & AUDIT REVIEW
    // =========================================================================
    let allRevalidationRequests = [];
    let activeRevalDetail = null;
    let proposedCorrections = {};

    async function loadRevalidationRequests() {
        try {
            const res = await adminFetch("/api/admin/revalidation/list");
            if (!res.ok) throw new Error("Failed to load revalidation requests.");
            const data = await res.json();
            allRevalidationRequests = data.requests || [];

            const total = allRevalidationRequests.length;
            const pending = allRevalidationRequests.filter(r => r.status === "Pending" || !r.status).length;
            const approved = allRevalidationRequests.filter(r => r.status === "Revalidated").length;
            const rejected = allRevalidationRequests.filter(r => r.status === "Rejected").length;

            if ($("#statRevalTotal")) $("#statRevalTotal").textContent = total;
            if ($("#statRevalPending")) $("#statRevalPending").textContent = pending;
            if ($("#statRevalApproved")) $("#statRevalApproved").textContent = approved;
            if ($("#statRevalRejected")) $("#statRevalRejected").textContent = rejected;

            renderRevalidationTable();
        } catch (err) {
            console.warn("[REVAL-LIST-ERROR]", err.message);
            renderRevalidationTable();
        }
    }

    const refreshRevalBtn = $("#refreshRevalBtn");
    if (refreshRevalBtn) {
        refreshRevalBtn.addEventListener("click", () => loadRevalidationRequests());
    }

    function renderRevalidationTable() {
        const tbody = $("#revalidationTableBody");
        if (!tbody) return;

        if (allRevalidationRequests.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="table-empty">No student revalidation requests registered.</td></tr>`;
            return;
        }

        tbody.innerHTML = allRevalidationRequests.map(r => {
            let statusBadge = "badge-gold";
            if (r.status === "Revalidated") statusBadge = "badge-green";
            else if (r.status === "Rejected") statusBadge = "badge-suspended";

            const complaintShort = (r.complaint || "Re-evaluation requested").substring(0, 45) + (r.complaint && r.complaint.length > 45 ? "..." : "");

            return `
                <tr>
                    <td><code style="font-size:11px;">${escapeHtml((r.id || "").substring(0, 10))}</code></td>
                    <td><strong>${escapeHtml(r.rollNumber || "—")}</strong></td>
                    <td>${escapeHtml(r.studentName || "—")}</td>
                    <td>${escapeHtml(r.examName || r.examId || "—")}</td>
                    <td><strong>${r.currentScore !== null && r.currentScore !== undefined ? r.currentScore : (r.previousScore || "—")}</strong> / ${r.totalMarks || 50}</td>
                    <td title="${escapeHtml(r.complaint || "")}">${escapeHtml(complaintShort)}</td>
                    <td>${r.createdAt ? escapeHtml(formatDateTime(r.createdAt)) : "—"}</td>
                    <td><span class="badge-pill ${statusBadge}">${escapeHtml(r.status || "Pending")}</span></td>
                    <td style="text-align:right;">
                        <button class="button-secondary btn-sm" data-review-reval="${escapeHtml(r.id)}" style="background:#fbf6ea; color:#8c6914; border-color:#e6cca0; font-weight:700;">
                            Review Grievance →
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        $$("[data-review-reval]").forEach(btn => {
            btn.addEventListener("click", () => {
                const reqId = btn.getAttribute("data-review-reval");
                openRevalidationReviewModal(reqId);
            });
        });
    }

    async function openRevalidationReviewModal(reqId) {
        const modal = $("#revalidationReviewModal");
        if (!modal) return;

        proposedCorrections = {};
        const previewBox = $("#revalRevisionPreviewBox");
        if (previewBox) previewBox.style.display = "none";

        setModal(modal, true);

        const container = $("#revalQuestionsContainer");
        if (container) container.innerHTML = `<p style="text-align:center; padding:30px; color:#64748b;">Loading candidate responses and answer keys...</p>`;

        try {
            const res = await adminFetch(`/api/admin/revalidation/detail?id=${encodeURIComponent(reqId)}`);
            if (!res.ok) throw new Error("Failed to load revalidation request details.");
            const data = await res.json();
            activeRevalDetail = data;

            const req = data.request || {};
            if ($("#revalModalStudent")) $("#revalModalStudent").textContent = req.studentName || "—";
            if ($("#revalModalRoll")) $("#revalModalRoll").textContent = req.rollNumber || "—";
            if ($("#revalModalExam")) $("#revalModalExam").textContent = req.examName || req.examId || "—";
            const maxRevalMarks = req.totalMarks || (data.exam && data.exam.total_marks) || 50;
            if ($("#revalModalScore")) $("#revalModalScore").textContent = `${req.currentScore !== null && req.currentScore !== undefined ? req.currentScore : (req.previousScore || 0)} / ${maxRevalMarks}`;
            if ($("#revalModalComplaint")) $("#revalModalComplaint").textContent = `"${req.complaint || "No detailed complaint provided."}"`;

            const statusEl = $("#revalModalStatus");
            if (statusEl) {
                statusEl.textContent = req.status || "Pending";
                statusEl.className = "badge-pill " + (req.status === "Revalidated" ? "badge-green" : req.status === "Rejected" ? "badge-suspended" : "badge-gold");
            }

            renderRevalidationQuestions(data);
        } catch (err) {
            console.error("[REVAL-DETAIL-ERROR]", err);
            if (container) container.innerHTML = `<p style="color:#dc2626; text-align:center; padding:20px;">Error: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderRevalidationQuestions(detail) {
        const container = $("#revalQuestionsContainer");
        if (!container) return;

        const questions = detail.questions || [];
        const secureKeys = detail.secureKeys || [];
        const studentAnswers = (detail.attempt && detail.attempt.answers) || {};

        if (questions.length === 0) {
            container.innerHTML = `<p style="text-align:center; color:#64748b; padding:20px;">No question records found for this examination.</p>`;
            return;
        }

        const keysMap = {};
        secureKeys.forEach(k => {
            const keyNum = k.question_number || (k.id ? parseInt(String(k.id).replace(/\D/g, ""), 10) : null);
            if (keyNum) keysMap[keyNum] = k.correct_answer || k.correct_answers || "A";
        });

        container.innerHTML = questions.map((q, idx) => {
            const qNum = q.question_number || (idx + 1);
            const qId = q.id || `q_${qNum}`;
            const studentAns = studentAnswers[qId] || studentAnswers[qNum] || "Not Answered";
            const officialKey = keysMap[qNum] || q.correct_answer || "A";
            const isMatch = String(studentAns).toUpperCase() === String(officialKey).toUpperCase();

            return `
                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:14px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <strong style="color:#0f172a; font-size:13px;">Q${qNum}. ${escapeHtml(q.question_text || "")}</strong>
                        <span class="badge-pill ${isMatch ? "badge-green" : "badge-suspended"}" style="font-size:11px;">
                            ${isMatch ? "✓ Current Match" : "✕ Current Mismatch"}
                        </span>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:12px; margin-bottom:8px;">
                        <div><strong>A:</strong> ${escapeHtml(q.option_a || "")}</div>
                        <div><strong>B:</strong> ${escapeHtml(q.option_b || "")}</div>
                        <div><strong>C:</strong> ${escapeHtml(q.option_c || "")}</div>
                        <div><strong>D:</strong> ${escapeHtml(q.option_d || "")}</div>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:6px; font-size:12px; flex-wrap:wrap; gap:8px;">
                        <div>
                            <span>Student's Submitted Answer: <strong style="color:#0f172a; font-size:14px;">${escapeHtml(String(studentAns))}</strong></span>
                            <span style="margin-left:14px;">Official Master Key: <strong style="color:#15803d; font-size:14px;">${escapeHtml(String(officialKey))}</strong></span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <label style="font-weight:600; color:#475569;">Correct Key to:</label>
                            <select data-reval-key-select="${qNum}" style="padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; font-weight:700;">
                                <option value="A" ${officialKey === "A" ? "selected" : ""}>A</option>
                                <option value="B" ${officialKey === "B" ? "selected" : ""}>B</option>
                                <option value="C" ${officialKey === "C" ? "selected" : ""}>C</option>
                                <option value="D" ${officialKey === "D" ? "selected" : ""}>D</option>
                            </select>
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        $$("[data-reval-key-select]").forEach(sel => {
            sel.addEventListener("change", e => {
                const qNum = sel.getAttribute("data-reval-key-select");
                proposedCorrections[qNum] = e.target.value;
            });
        });
    }

    // Preview Recalculation Handler
    const revalPreviewBtn = $("#revalPreviewBtn");
    if (revalPreviewBtn) {
        revalPreviewBtn.addEventListener("click", () => {
            if (!activeRevalDetail) return;
            const questions = activeRevalDetail.questions || [];
            const secureKeys = activeRevalDetail.secureKeys || [];
            const studentAnswers = (activeRevalDetail.attempt && activeRevalDetail.attempt.answers) || {};

            const keysMap = {};
            secureKeys.forEach(k => {
                const keyNum = k.question_number || (k.id ? parseInt(String(k.id).replace(/\D/g, ""), 10) : null);
                if (keyNum) keysMap[keyNum] = k.correct_answer || "A";
            });

            Object.keys(proposedCorrections).forEach(qNum => {
                keysMap[qNum] = proposedCorrections[qNum];
            });

            let newScore = 0;
            questions.forEach((q, idx) => {
                const qNum = q.question_number || (idx + 1);
                const qId = q.id || `q_${qNum}`;
                const studentAns = studentAnswers[qId] || studentAnswers[qNum] || "";
                const effectiveKey = keysMap[qNum] || q.correct_answer || "A";
                if (String(studentAns).toUpperCase() === String(effectiveKey).toUpperCase()) {
                    newScore += (Number(q.marks) || 1);
                }
            });

            const originalScore = (activeRevalDetail.request && (activeRevalDetail.request.currentScore !== null ? activeRevalDetail.request.currentScore : activeRevalDetail.request.previousScore)) || 0;
            const diff = newScore - originalScore;
            const diffText = diff > 0 ? `(+${diff} marks increase)` : diff < 0 ? `(${diff} marks decrease)` : `(No change)`;

            const previewBox = $("#revalRevisionPreviewBox");
            const marksEl = $("#revalPreviewMarks");
            const examMax = (activeRevalDetail.exam && activeRevalDetail.exam.total_marks) || (activeRevalDetail.request && activeRevalDetail.request.totalMarks) || 50;
            if (previewBox && marksEl) {
                previewBox.style.display = "flex";
                marksEl.textContent = `${newScore} / ${examMax} ${diffText}`;
            }
            showToast(`Recalculated Score: ${newScore} / ${examMax} ${diffText}`);
        });
    }

    // Approve Handler
    const revalApproveBtn = $("#revalApproveBtn");
    if (revalApproveBtn) {
        revalApproveBtn.addEventListener("click", async () => {
            if (!activeRevalDetail || !activeRevalDetail.request) return;
            const requestId = activeRevalDetail.request.id;

            const notes = prompt("Enter administrative notes for approving this revalidation (optional):", "Revalidation verified and approved.");
            if (notes === null) return;

            try {
                const res = await adminFetch("/api/admin/revalidation/approve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        requestId,
                        correctedKeys: proposedCorrections,
                        adminNotes: notes
                    })
                });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || "Revalidation successfully applied!");
                    setModal($("#revalidationReviewModal"), false);
                    await loadRevalidationRequests();
                } else {
                    showToast(data.error || "Failed to approve revalidation.", true);
                }
            } catch (err) {
                showToast("Error: " + err.message, true);
            }
        });
    }

    // Reject Handler
    const revalRejectBtn = $("#revalRejectBtn");
    if (revalRejectBtn) {
        revalRejectBtn.addEventListener("click", async () => {
            if (!activeRevalDetail || !activeRevalDetail.request) return;
            const requestId = activeRevalDetail.request.id;

            const reason = prompt("Enter reason for rejecting this student grievance:", "Responses audited; original evaluation confirmed correct.");
            if (!reason) return;

            try {
                const res = await adminFetch("/api/admin/revalidation/reject", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        requestId,
                        reason
                    })
                });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || "Grievance rejected.");
                    setModal($("#revalidationReviewModal"), false);
                    await loadRevalidationRequests();
                } else {
                    showToast(data.error || "Failed to reject revalidation.", true);
                }
            } catch (err) {
                showToast("Error: " + err.message, true);
            }
        });
    }

    // =========================================================================
    // 9B. BULK EXAM REVALIDATION & COHORT KEY CORRECTION
    // =========================================================================
    let bulkActiveExamId = "";
    let bulkLoadedQuestions = [];
    let bulkPreviewData = null;
    let bulkSelectedRolls = new Set();
    let bulkLastOperationReport = null;

    const openBulkRevalModalBtn = $("#openBulkRevalModalBtn");
    if (openBulkRevalModalBtn) {
        openBulkRevalModalBtn.addEventListener("click", async () => {
            resetBulkRevalidationModal();
            populateBulkExamDropdown();
            setModal($("#bulkRevalidationModal"), true);
        });
    }

    function resetBulkRevalidationModal() {
        bulkActiveExamId = "";
        bulkLoadedQuestions = [];
        bulkPreviewData = null;
        bulkSelectedRolls = new Set();
        bulkLastOperationReport = null;

        const configSec = $("#bulkRevalConfigSection");
        const prevSec = $("#bulkRevalPreviewSection");
        const succSec = $("#bulkRevalSuccessSection");
        if (configSec) configSec.style.display = "block";
        if (prevSec) prevSec.style.display = "none";
        if (succSec) succSec.style.display = "none";

        const qCard = $("#bulkQuestionDetailCard");
        if (qCard) qCard.style.display = "none";

        const qSelect = $("#bulkRevalQuestionSelect");
        if (qSelect) {
            qSelect.disabled = true;
            qSelect.innerHTML = '<option value="">-- Select an exam first --</option>';
        }

        const revSelect = $("#bulkRevisedKeySelect");
        if (revSelect) revSelect.value = "";

        const reasonInp = $("#bulkRevalReasonInput");
        if (reasonInp) reasonInp.value = "";

        const confirmInp = $("#bulkConfirmInput");
        if (confirmInp) confirmInp.value = "";

        const executeBtn = $("#bulkExecuteBtn");
        if (executeBtn) {
            executeBtn.disabled = true;
            executeBtn.style.opacity = "0.5";
            executeBtn.style.cursor = "not-allowed";
            executeBtn.textContent = "⚡ Confirm & Commit Cohort Revalidation";
        }

        const analyzeBtn = $("#bulkAnalyzeBtn");
        if (analyzeBtn) {
            analyzeBtn.disabled = true;
            analyzeBtn.textContent = "⚡ Analyze Impact & Preview Revalidation";
        }

        const configStatus = $("#bulkConfigStatus");
        if (configStatus) {
            configStatus.textContent = "Select an exam and question to begin impact preview.";
            configStatus.style.color = "#64748b";
        }

        const footerStatus = $("#bulkFooterStatus");
        if (footerStatus) footerStatus.textContent = "Ready.";
    }

    function populateBulkExamDropdown() {
        const examSelect = $("#bulkRevalExamSelect");
        if (!examSelect) return;

        let optionsHtml = '<option value="">-- Choose Examination --</option>';
        const list = (allExamsList && allExamsList.length > 0) ? allExamsList : [];

        list.forEach(e => {
            const count = e.totalCompleted || 0;
            optionsHtml += `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title || e.name || "Exam")} (${count} submitted attempts)</option>`;
        });

        examSelect.innerHTML = optionsHtml;
    }

    const bulkRevalExamSelect = $("#bulkRevalExamSelect");
    if (bulkRevalExamSelect) {
        bulkRevalExamSelect.addEventListener("change", async () => {
            const examId = bulkRevalExamSelect.value;
            const qSelect = $("#bulkRevalQuestionSelect");
            const qCard = $("#bulkQuestionDetailCard");
            const analyzeBtn = $("#bulkAnalyzeBtn");
            const configStatus = $("#bulkConfigStatus");

            if (qCard) qCard.style.display = "none";
            if (analyzeBtn) analyzeBtn.disabled = true;

            if (!examId) {
                if (qSelect) {
                    qSelect.disabled = true;
                    qSelect.innerHTML = '<option value="">-- Select an exam first --</option>';
                }
                if (configStatus) configStatus.textContent = "Select an exam to load its questions.";
                return;
            }

            if (configStatus) {
                configStatus.textContent = "Loading examination questions and authoritative keys...";
                configStatus.style.color = "#d97706";
            }

            try {
                const res = await adminFetch(`/api/admin/revalidation/exam-questions?examId=${encodeURIComponent(examId)}`);
                if (!res.ok) throw new Error("Failed to load exam questions.");
                const data = await res.json();

                bulkActiveExamId = examId;
                bulkLoadedQuestions = data.questions || [];

                if (qSelect) {
                    let qOpts = '<option value="">-- Choose Question to Correct --</option>';
                    bulkLoadedQuestions.forEach(q => {
                        const preview = (q.statement || "").replace(/<[^>]*>?/gm, "").substring(0, 55);
                        qOpts += `<option value="${q.question_number}">Q${q.question_number}: ${escapeHtml(preview)}... [Current Key: ${escapeHtml(q.currentKey)}]</option>`;
                    });
                    qSelect.innerHTML = qOpts;
                    qSelect.disabled = false;
                }

                if (configStatus) {
                    configStatus.textContent = `Loaded ${bulkLoadedQuestions.length} questions. Choose a question to adjust.`;
                    configStatus.style.color = "#15803d";
                }
            } catch (err) {
                if (configStatus) {
                    configStatus.textContent = "Error: " + err.message;
                    configStatus.style.color = "#dc2626";
                }
            }
        });
    }

    const bulkRevalQuestionSelect = $("#bulkRevalQuestionSelect");
    if (bulkRevalQuestionSelect) {
        bulkRevalQuestionSelect.addEventListener("change", () => {
            const qNum = parseInt(bulkRevalQuestionSelect.value, 10);
            const qCard = $("#bulkQuestionDetailCard");
            const analyzeBtn = $("#bulkAnalyzeBtn");
            const configStatus = $("#bulkConfigStatus");

            if (!qNum || isNaN(qNum)) {
                if (qCard) qCard.style.display = "none";
                if (analyzeBtn) analyzeBtn.disabled = true;
                return;
            }

            const qObj = bulkLoadedQuestions.find(q => q.question_number === qNum);
            if (!qObj) return;

            if ($("#bulkQuestionBadge")) $("#bulkQuestionBadge").textContent = `Question ${qNum}`;
            if ($("#bulkCurrentKeyDisplay")) $("#bulkCurrentKeyDisplay").textContent = qObj.currentKey || "A";
            if ($("#bulkQuestionStatement")) $("#bulkQuestionStatement").textContent = qObj.statement || "";

            const optsContainer = $("#bulkQuestionOptionsList");
            if (optsContainer) {
                const opts = qObj.options || [];
                optsContainer.innerHTML = opts.map((opt, idx) => {
                    const letter = String.fromCharCode(65 + idx);
                    const optText = typeof opt === "object" ? (opt.text || opt.label || JSON.stringify(opt)) : String(opt);
                    const isKey = (qObj.currentKey || "").toUpperCase().includes(letter);
                    const borderCol = isKey ? "#d97706" : "#e2e8f0";
                    const bgCol = isKey ? "#fffbeb" : "#f8fafc";
                    return `
                        <div style="padding:8px 12px; border:1px solid ${borderCol}; background:${bgCol}; border-radius:6px;">
                            <strong>${letter}.</strong> ${escapeHtml(optText)}
                        </div>
                    `;
                }).join("");
            }

            const revSelect = $("#bulkRevisedKeySelect");
            if (revSelect) {
                revSelect.value = "";
            }

            if (qCard) qCard.style.display = "block";
            if (analyzeBtn) analyzeBtn.disabled = true;
            if (configStatus) {
                configStatus.textContent = `Question ${qNum} selected. Choose revised key and click Analyze.`;
                configStatus.style.color = "#d97706";
            }
        });
    }

    const bulkRevisedKeySelect = $("#bulkRevisedKeySelect");
    if (bulkRevisedKeySelect) {
        bulkRevisedKeySelect.addEventListener("change", () => {
            const newKey = bulkRevisedKeySelect.value;
            const qNum = parseInt($("#bulkRevalQuestionSelect")?.value, 10);
            const analyzeBtn = $("#bulkAnalyzeBtn");
            if (analyzeBtn) {
                analyzeBtn.disabled = !newKey || !qNum;
            }
        });
    }

    const bulkAnalyzeBtn = $("#bulkAnalyzeBtn");
    if (bulkAnalyzeBtn) {
        bulkAnalyzeBtn.addEventListener("click", async () => {
            const examId = bulkActiveExamId;
            const qNum = parseInt($("#bulkRevalQuestionSelect")?.value, 10);
            const revisedKey = $("#bulkRevisedKeySelect")?.value;
            const reason = $("#bulkRevalReasonInput")?.value.trim() || `Authoritative answer key revision for Question ${qNum}.`;

            if (!examId || !qNum || !revisedKey) {
                showToast("Please select an exam, question, and revised answer key.", true);
                return;
            }

            bulkAnalyzeBtn.disabled = true;
            bulkAnalyzeBtn.textContent = "⚡ Analyzing Impact across Cohort...";

            const footerStatus = $("#bulkFooterStatus");
            if (footerStatus) footerStatus.textContent = "Recalculating scores with deterministic seeds...";

            try {
                const res = await adminFetch("/api/admin/revalidation/bulk-preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        examId,
                        corrections: [{ questionNumber: qNum, revisedKey }],
                        reason
                    })
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Failed to preview cohort impact.");
                }

                bulkPreviewData = await res.json();
                renderBulkPreviewUI(bulkPreviewData);
                showToast(`Analysis complete: ${bulkPreviewData.affectedCount} candidate(s) impacted.`);
            } catch (err) {
                showToast("Error: " + err.message, true);
            } finally {
                bulkAnalyzeBtn.disabled = false;
                bulkAnalyzeBtn.textContent = "⚡ Analyze Impact & Preview Revalidation";
                if (footerStatus) footerStatus.textContent = "Preview ready.";
            }
        });
    }

    function renderBulkPreviewUI(data) {
        const prevSec = $("#bulkRevalPreviewSection");
        if (!prevSec) return;

        const corr = (data.corrections && data.corrections[0]) || {};
        if ($("#previewKeyChange")) {
            $("#previewKeyChange").textContent = `Q${corr.questionNumber || "?"}: ${corr.previousKey || "?"} → ${corr.revisedKey || "?"}`;
        }
        if ($("#previewTotalSubmissions")) {
            $("#previewTotalSubmissions").textContent = `${data.totalSubmitted || 0} Submissions`;
        }
        if ($("#previewAffectedCount")) {
            $("#previewAffectedCount").textContent = `${data.affectedCount || 0} Candidate(s)`;
        }
        if ($("#bulkAllAffectedBadge")) {
            $("#bulkAllAffectedBadge").textContent = data.affectedCount || 0;
        }

        const scoreChanges = (data.affectedStudents || []).filter(s => s.delta !== 0).length;
        if ($("#previewScoreChangeCount")) {
            $("#previewScoreChangeCount").textContent = `${scoreChanges} Scores Changed`;
        }

        // Select all affected candidates by default
        bulkSelectedRolls = new Set((data.affectedStudents || []).map(s => s.rollNumber));

        renderBulkAffectedTable();
        updateBulkConfirmationState();

        prevSec.style.display = "block";
        prevSec.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function renderBulkAffectedTable() {
        const tbody = $("#bulkAffectedTableBody");
        if (!tbody || !bulkPreviewData) return;

        const students = bulkPreviewData.affectedStudents || [];
        if (students.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="padding:16px; text-align:center; color:#64748b;">No candidate scores are impacted by this key correction.</td></tr>`;
            return;
        }

        tbody.innerHTML = students.map(s => {
            const isChecked = bulkSelectedRolls.has(s.rollNumber);
            let deltaHtml = `<span style="padding:2px 8px; border-radius:12px; font-weight:700; background:#f1f5f9; color:#64748b;">0.00</span>`;
            if (s.delta > 0) {
                deltaHtml = `<span style="padding:2px 8px; border-radius:12px; font-weight:700; background:#dcfce7; color:#15803d;">+${s.delta.toFixed(2)}</span>`;
            } else if (s.delta < 0) {
                deltaHtml = `<span style="padding:2px 8px; border-radius:12px; font-weight:700; background:#fee2e2; color:#b91c1c;">${s.delta.toFixed(2)}</span>`;
            }

            return `
                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="padding:8px 12px; text-align:center;">
                        <input type="checkbox" data-bulk-roll="${escapeHtml(s.rollNumber)}" ${isChecked ? "checked" : ""}>
                    </td>
                    <td style="padding:8px 12px; font-weight:700; color:#0f172a; font-family:'Space Grotesk',monospace;">${escapeHtml(s.rollNumber)}</td>
                    <td style="padding:8px 12px; font-weight:600;">${escapeHtml(s.studentName || "—")}</td>
                    <td style="padding:8px 12px; color:#475569;">${escapeHtml(s.branch || "IT")}</td>
                    <td style="padding:8px 12px;"><span class="badge-pill badge-gold" style="font-size:10px;">${escapeHtml(s.assignedSet || "Set A")}</span></td>
                    <td style="padding:8px 12px; text-align:center; font-family:'Space Grotesk',monospace;">${s.previousMarks !== undefined ? s.previousMarks.toFixed(2) : "0.00"}</td>
                    <td style="padding:8px 12px; text-align:center; font-weight:700; color:#0f172a; font-family:'Space Grotesk',monospace;">${s.revisedMarks !== undefined ? s.revisedMarks.toFixed(2) : "0.00"}</td>
                    <td style="padding:8px 12px; text-align:center;">${deltaHtml}</td>
                </tr>
            `;
        }).join("");

        $$("[data-bulk-roll]").forEach(chk => {
            chk.addEventListener("change", () => {
                const roll = chk.getAttribute("data-bulk-roll");
                if (chk.checked) {
                    bulkSelectedRolls.add(roll);
                } else {
                    bulkSelectedRolls.delete(roll);
                }
                updateBulkConfirmationState();
            });
        });
    }

    function updateBulkConfirmationState() {
        const count = bulkSelectedRolls.size;
        if ($("#bulkTargetCountBadge")) $("#bulkTargetCountBadge").textContent = count;
        if ($("#selectedRevalCounter")) $("#selectedRevalCounter").textContent = `${count} candidates selected for revalidation`;

        const allChk = $("#bulkSelectAllCheckbox");
        if (allChk && bulkPreviewData) {
            allChk.checked = count > 0 && count === (bulkPreviewData.affectedStudents || []).length;
            allChk.indeterminate = count > 0 && count < (bulkPreviewData.affectedStudents || []).length;
        }

        checkBulkExecuteReadiness();
    }

    function checkBulkExecuteReadiness() {
        const confirmVal = ($("#bulkConfirmInput")?.value || "").trim().toUpperCase();
        const executeBtn = $("#bulkExecuteBtn");
        if (!executeBtn) return;

        const isPhraseMatched = confirmVal === "REVALIDATE";
        const hasSelection = bulkSelectedRolls.size > 0;

        if (isPhraseMatched && hasSelection) {
            executeBtn.disabled = false;
            executeBtn.style.opacity = "1";
            executeBtn.style.cursor = "pointer";
        } else {
            executeBtn.disabled = true;
            executeBtn.style.opacity = "0.5";
            executeBtn.style.cursor = "not-allowed";
        }
    }

    const bulkSelectAllCheckbox = $("#bulkSelectAllCheckbox");
    if (bulkSelectAllCheckbox) {
        bulkSelectAllCheckbox.addEventListener("change", () => {
            if (!bulkPreviewData) return;
            const checked = bulkSelectAllCheckbox.checked;
            if (checked) {
                bulkSelectedRolls = new Set((bulkPreviewData.affectedStudents || []).map(s => s.rollNumber));
            } else {
                bulkSelectedRolls.clear();
            }
            $$("[data-bulk-roll]").forEach(chk => { chk.checked = checked; });
            updateBulkConfirmationState();
        });
    }

    const btnModeRevalAll = $("#btnModeRevalAll");
    if (btnModeRevalAll) {
        btnModeRevalAll.addEventListener("click", () => {
            if (!bulkPreviewData) return;
            bulkSelectedRolls = new Set((bulkPreviewData.affectedStudents || []).map(s => s.rollNumber));
            $$("[data-bulk-roll]").forEach(chk => { chk.checked = true; });
            updateBulkConfirmationState();
        });
    }

    const btnModeDeselectAll = $("#btnModeDeselectAll");
    if (btnModeDeselectAll) {
        btnModeDeselectAll.addEventListener("click", () => {
            bulkSelectedRolls.clear();
            $$("[data-bulk-roll]").forEach(chk => { chk.checked = false; });
            updateBulkConfirmationState();
        });
    }

    const bulkConfirmInput = $("#bulkConfirmInput");
    if (bulkConfirmInput) {
        bulkConfirmInput.addEventListener("input", checkBulkExecuteReadiness);
    }

    const bulkExecuteBtn = $("#bulkExecuteBtn");
    if (bulkExecuteBtn) {
        bulkExecuteBtn.addEventListener("click", async () => {
            if (!bulkPreviewData) return;
            const confirmVal = ($("#bulkConfirmInput")?.value || "").trim().toUpperCase();
            if (confirmVal !== "REVALIDATE") {
                showToast("Please type REVALIDATE to confirm bulk execution.", true);
                return;
            }
            if (bulkSelectedRolls.size === 0) {
                showToast("Please select at least one candidate to revalidate.", true);
                return;
            }

            bulkExecuteBtn.disabled = true;
            bulkExecuteBtn.textContent = "⚡ Committing Cohort Revalidation...";
            const footerStatus = $("#bulkFooterStatus");
            if (footerStatus) footerStatus.textContent = "Writing official results to Cloud Firestore...";

            try {
                const res = await adminFetch("/api/admin/revalidation/bulk-execute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        operationId: bulkPreviewData.operationId,
                        examId: bulkPreviewData.examId,
                        corrections: bulkPreviewData.corrections,
                        reason: bulkPreviewData.reason,
                        confirmedCount: bulkSelectedRolls.size,
                        selectedRolls: Array.from(bulkSelectedRolls)
                    })
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Failed to execute bulk revalidation.");
                }

                bulkLastOperationReport = await res.json();

                // Transition to Phase 3 (Success)
                const configSec = $("#bulkRevalConfigSection");
                const prevSec = $("#bulkRevalPreviewSection");
                const succSec = $("#bulkRevalSuccessSection");
                if (configSec) configSec.style.display = "none";
                if (prevSec) prevSec.style.display = "none";
                if (succSec) succSec.style.display = "block";

                if ($("#bulkResultOpId")) $("#bulkResultOpId").textContent = bulkLastOperationReport.operationId || bulkPreviewData.operationId;
                if ($("#bulkResultUpdatedCount")) $("#bulkResultUpdatedCount").textContent = bulkLastOperationReport.updatedCount || bulkSelectedRolls.size;

                showToast(`Cohort revalidation successful! ${bulkLastOperationReport.updatedCount || bulkSelectedRolls.size} candidates updated.`);
                if (footerStatus) footerStatus.textContent = "Operation successfully committed.";

                await loadRevalidationRequests();
            } catch (err) {
                showToast("Execution error: " + err.message, true);
                bulkExecuteBtn.disabled = false;
                bulkExecuteBtn.textContent = "⚡ Confirm & Commit Cohort Revalidation";
                if (footerStatus) footerStatus.textContent = "Execution halted.";
            }
        });
    }

    const downloadBulkReportBtn = $("#downloadBulkReportBtn");
    if (downloadBulkReportBtn) {
        downloadBulkReportBtn.addEventListener("click", () => {
            if (!bulkPreviewData) {
                showToast("No revalidation report data available.", true);
                return;
            }

            const updatedRecords = (bulkLastOperationReport && bulkLastOperationReport.updatedRecords) || [];
            let reportRows = [];

            if (updatedRecords.length > 0) {
                reportRows = updatedRecords.map(r => ({
                    "Operation ID": bulkLastOperationReport.operationId || bulkPreviewData.operationId,
                    "Examination": bulkLastOperationReport.examTitle || bulkPreviewData.examTitle || "Examination",
                    "Roll Number": r.rollNumber,
                    "Student Name": r.studentName,
                    "Branch": r.branch || "Information Technology",
                    "Batch": r.batch || "3rd Year B.Tech",
                    "Assigned Set": r.assignedSet || "Set A",
                    "Previous Marks": r.previousMarks,
                    "Revised Marks": r.revisedMarks,
                    "Score Delta": r.delta > 0 ? `+${r.delta}` : `${r.delta}`,
                    "Status": r.status || "REVALIDATED",
                    "Revalidated At": r.timestamp || new Date().toISOString()
                }));
            } else {
                const corr = (bulkPreviewData.corrections && bulkPreviewData.corrections[0]) || {};
                reportRows = Array.from(bulkSelectedRolls).map(roll => {
                    const s = (bulkPreviewData.affectedStudents || []).find(st => st.rollNumber === roll) || {};
                    return {
                        "Operation ID": bulkPreviewData.operationId,
                        "Examination": bulkPreviewData.examTitle || "Examination",
                        "Roll Number": roll,
                        "Student Name": s.studentName || roll,
                        "Branch": s.branch || "Information Technology",
                        "Batch": s.batch || "3rd Year B.Tech",
                        "Assigned Set": s.assignedSet || "Set A",
                        "Question Corrected": `Q${corr.questionNumber || "?"}`,
                        "Previous Key": corr.previousKey || "A",
                        "Revised Key": corr.revisedKey || "A",
                        "Previous Marks": s.previousMarks !== undefined ? s.previousMarks : 0,
                        "Revised Marks": s.revisedMarks !== undefined ? s.revisedMarks : 0,
                        "Score Delta": s.delta > 0 ? `+${s.delta}` : `${s.delta}`,
                        "Status": "REVALIDATED",
                        "Revalidated At": new Date().toISOString()
                    };
                });
            }

            const fileBase = sanitizeFileName(bulkPreviewData.examTitle || "Bulk_Revalidation");
            exportToExcel(reportRows, `${fileBase}_Revalidation_Report.xlsx`, "Revalidation Report");
        });
    }

    // =========================================================================
    // 9. COMPLETE EXAM-WIDE BULK REVALIDATION CONTROLLER
    // =========================================================================
    let fullRevalActiveExamId = "";
    let fullRevalOriginalQuestions = [];
    let fullRevalRevisedQuestions = [];
    let fullRevalOriginalKeys = {};
    let fullRevalOriginalExplanations = {};
    let fullRevalPreviewData = null;
    let fullRevalLastOperationReport = null;

    const openFullExamRevalModalBtn = $("#openFullExamRevalModalBtn");
    const fullExamRevalidationModal = $("#fullExamRevalidationModal");

    if (openFullExamRevalModalBtn && fullExamRevalidationModal) {
        openFullExamRevalModalBtn.addEventListener("click", () => {
            resetFullExamRevalModal();
            populateFullRevalExamDropdown();
            setModal(fullExamRevalidationModal, true);
        });
    }

    function resetFullExamRevalModal() {
        fullRevalActiveExamId = "";
        fullRevalOriginalQuestions = [];
        fullRevalRevisedQuestions = [];
        fullRevalOriginalKeys = {};
        fullRevalOriginalExplanations = {};
        fullRevalPreviewData = null;
        fullRevalLastOperationReport = null;

        const setupSec = $("#fullRevalSetupSection");
        const prevSec = $("#fullRevalPreviewSection");
        const succSec = $("#fullRevalSuccessSection");
        if (setupSec) setupSec.style.display = "block";
        if (prevSec) prevSec.style.display = "none";
        if (succSec) succSec.style.display = "none";

        const metaBox = $("#fullRevalExamMetaBox");
        if (metaBox) metaBox.style.display = "none";
        const pdfBox = $("#fullRevalPdfUploadBox");
        if (pdfBox) pdfBox.style.display = "none";
        const editorHeader = $("#fullRevalEditorHeader");
        if (editorHeader) editorHeader.style.display = "none";
        const qContainer = $("#fullRevalQuestionsContainer");
        if (qContainer) qContainer.innerHTML = "";

        const confirmInp = $("#fullRevalConfirmInput");
        if (confirmInp) confirmInp.value = "";
        const commitBtn = $("#fullRevalCommitBtn");
        if (commitBtn) {
            commitBtn.disabled = true;
            commitBtn.style.opacity = "0.5";
            commitBtn.style.cursor = "not-allowed";
        }
        const footerStatus = $("#fullRevalFooterStatus");
        if (footerStatus) footerStatus.textContent = "Select an examination to begin.";
    }

    function populateFullRevalExamDropdown() {
        const select = $("#fullRevalExamSelect");
        if (!select) return;
        let html = '<option value="">-- Choose Examination --</option>';
        (allExamsList || []).forEach(e => {
            const count = e.totalCompleted || 0;
            html += `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title || e.name || "Exam")} (${count} submitted attempts)</option>`;
        });
        select.innerHTML = html;
    }

    const fullRevalExamSelect = $("#fullRevalExamSelect");
    if (fullRevalExamSelect) {
        fullRevalExamSelect.addEventListener("change", async () => {
            const examId = fullRevalExamSelect.value;
            if (!examId) {
                resetFullExamRevalModal();
                return;
            }

            const footerStatus = $("#fullRevalFooterStatus");
            if (footerStatus) footerStatus.textContent = "Loading complete exam questions, authoritative keys, and version history...";

            try {
                const res = await adminFetch(`/api/admin/revalidation/full-exam-detail?examId=${encodeURIComponent(examId)}`);
                if (!res.ok) throw new Error("Failed to load full exam detail.");
                const data = await res.json();

                fullRevalActiveExamId = examId;
                fullRevalOriginalQuestions = data.questions || [];
                fullRevalOriginalKeys = data.keys || {};
                fullRevalOriginalExplanations = data.explanations || {};

                fullRevalRevisedQuestions = JSON.parse(JSON.stringify(fullRevalOriginalQuestions)).map(q => {
                    const qNum = q.question_number;
                    const keyVal = fullRevalOriginalKeys[qNum] || q.correct_answer || (Array.isArray(q.correct_answers) ? q.correct_answers.join(",") : "A");
                    const expVal = fullRevalOriginalExplanations[qNum] || q.explanation || "";
                    return {
                        ...q,
                        correct_answer: keyVal,
                        correct_answers: String(keyVal).split(",").map(s => s.trim().toUpperCase()),
                        explanation: expVal
                    };
                });

                const metaBox = $("#fullRevalExamMetaBox");
                if (metaBox) metaBox.style.display = "block";
                if ($("#fullRevalCurrentVersion")) $("#fullRevalCurrentVersion").textContent = `v${data.currentVersion || 1}`;
                if ($("#fullRevalSubmittedCount")) $("#fullRevalSubmittedCount").textContent = data.submittedCount || 0;
                if ($("#fullRevalConfigSummary")) {
                    $("#fullRevalConfigSummary").textContent = `${data.totalQuestions || fullRevalOriginalQuestions.length}Q • ${data.totalMarks || 50}M • ${data.negativeMarking ? '-' + data.negativeMarkValue + ' Neg' : 'No Neg'}`;
                }

                const pdfBox = $("#fullRevalPdfUploadBox");
                if (pdfBox) pdfBox.style.display = "block";
                const editorHeader = $("#fullRevalEditorHeader");
                if (editorHeader) editorHeader.style.display = "flex";

                renderFullRevalQuestionCards();
                updateFullRevalBadges();

                if (footerStatus) footerStatus.textContent = `Loaded ${fullRevalOriginalQuestions.length} questions. You can edit questions, keys, options, marks, or upload updated PDFs.`;
            } catch (err) {
                showToast("Error loading exam: " + err.message, true);
                if (footerStatus) footerStatus.textContent = "Failed to load examination.";
            }
        });
    }

    function renderFullRevalQuestionCards() {
        const container = $("#fullRevalQuestionsContainer");
        if (!container) return;
        container.innerHTML = "";

        fullRevalRevisedQuestions.forEach((q, idx) => {
            const qNum = idx + 1;
            const isMsq = (q.type || "mcq").toLowerCase() === "msq";
            const qKey = Array.isArray(q.correct_answers) ? q.correct_answers.join(",") : (q.correct_answer || "A");
            const marks = q.marks !== undefined ? q.marks : 1;

            const card = document.createElement("div");
            card.className = "full-reval-q-card";
            card.setAttribute("data-reval-idx", idx);
            card.style.cssText = "background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; padding:16px; position:relative;";

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="badge-pill badge-gold" style="font-size:12px; font-weight:700;">Question ${qNum}</span>
                        <select class="reval-q-type-select" data-reval-idx="${idx}" style="padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:11px; font-weight:600;">
                            <option value="mcq" ${!isMsq ? "selected" : ""}>MCQ (Single Choice)</option>
                            <option value="msq" ${isMsq ? "selected" : ""}>MSQ (Multiple Select)</option>
                        </select>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <label style="font-size:12px; font-weight:600; color:#334155; display:flex; align-items:center; gap:4px;">
                            Marks:
                            <input type="number" step="0.25" min="0.25" max="50" value="${marks}" class="reval-q-marks-input" data-reval-idx="${idx}" style="width:60px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px; font-weight:700; text-align:center;">
                        </label>
                        <button type="button" class="reval-q-move-up-btn" data-reval-idx="${idx}" title="Move Up" style="padding:4px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc;" ${idx === 0 ? "disabled" : ""}>▲</button>
                        <button type="button" class="reval-q-move-down-btn" data-reval-idx="${idx}" title="Move Down" style="padding:4px 8px; font-size:12px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc;" ${idx === fullRevalRevisedQuestions.length - 1 ? "disabled" : ""}>▼</button>
                        <button type="button" class="reval-q-del-btn" data-reval-idx="${idx}" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:4px; padding:4px 8px; font-size:11px; font-weight:700;">✕ Delete</button>
                    </div>
                </div>

                <div style="margin-bottom:10px;">
                    <label style="font-size:11px; font-weight:600; color:#64748b; display:block; margin-bottom:2px;">Question Statement:</label>
                    <textarea class="reval-q-statement-input" data-reval-idx="${idx}" rows="2" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; font-family:inherit;">${escapeHtml(q.statement || q.question_text || "")}</textarea>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px; margin-bottom:10px;">
                    <div>
                        <span style="font-size:11px; font-weight:700; color:#475569;">A.</span>
                        <input type="text" class="reval-q-opt-a" data-reval-idx="${idx}" value="${escapeHtml(q.option_a || "")}" style="width:calc(100% - 20px); padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                    </div>
                    <div>
                        <span style="font-size:11px; font-weight:700; color:#475569;">B.</span>
                        <input type="text" class="reval-q-opt-b" data-reval-idx="${idx}" value="${escapeHtml(q.option_b || "")}" style="width:calc(100% - 20px); padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                    </div>
                    <div>
                        <span style="font-size:11px; font-weight:700; color:#475569;">C.</span>
                        <input type="text" class="reval-q-opt-c" data-reval-idx="${idx}" value="${escapeHtml(q.option_c || "")}" style="width:calc(100% - 20px); padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                    </div>
                    <div>
                        <span style="font-size:11px; font-weight:700; color:#475569;">D.</span>
                        <input type="text" class="reval-q-opt-d" data-reval-idx="${idx}" value="${escapeHtml(q.option_d || "")}" style="width:calc(100% - 20px); padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px; padding-top:8px; border-top:1px dashed #e2e8f0;">
                    <div>
                        <label style="font-size:11px; font-weight:700; color:#1e293b; display:block; margin-bottom:4px;">
                            Authoritative Correct Key:
                        </label>
                        ${isMsq ? `
                            <div style="display:flex; gap:12px; align-items:center; padding:6px 0;">
                                ${["A","B","C","D"].map(optL => `
                                    <label style="font-size:12px; font-weight:700; cursor:pointer;">
                                        <input type="checkbox" class="reval-msq-key" data-reval-idx="${idx}" value="${optL}" ${qKey.toUpperCase().includes(optL) ? "checked" : ""}> ${optL}
                                    </label>
                                `).join("")}
                            </div>
                        ` : `
                            <select class="reval-mcq-key-select" data-reval-idx="${idx}" style="padding:6px 10px; border:1.5px solid #d97706; border-radius:4px; font-weight:700; background:#fffbeb; font-size:12px;">
                                <option value="A" ${qKey.toUpperCase() === "A" ? "selected" : ""}>A</option>
                                <option value="B" ${qKey.toUpperCase() === "B" ? "selected" : ""}>B</option>
                                <option value="C" ${qKey.toUpperCase() === "C" ? "selected" : ""}>C</option>
                                <option value="D" ${qKey.toUpperCase() === "D" ? "selected" : ""}>D</option>
                            </select>
                        `}
                    </div>

                    <div>
                        <label style="font-size:11px; font-weight:600; color:#475569; display:block; margin-bottom:2px;">
                            Detailed Explanation:
                        </label>
                        <textarea class="reval-q-exp-input" data-reval-idx="${idx}" rows="1" placeholder="Explanation for students after exam..." style="width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px; font-family:inherit;">${escapeHtml(q.explanation || "")}</textarea>
                    </div>
                </div>
            `;

            container.appendChild(card);
        });

        wireFullRevalCardEvents();
    }

    function syncFullRevalFromDOM() {
        const cards = $$(".full-reval-q-card");
        cards.forEach(card => {
            const idx = parseInt(card.getAttribute("data-reval-idx"), 10);
            if (isNaN(idx) || !fullRevalRevisedQuestions[idx]) return;
            const q = fullRevalRevisedQuestions[idx];

            const stmt = card.querySelector(".reval-q-statement-input")?.value || "";
            const optA = card.querySelector(".reval-q-opt-a")?.value || "";
            const optB = card.querySelector(".reval-q-opt-b")?.value || "";
            const optC = card.querySelector(".reval-q-opt-c")?.value || "";
            const optD = card.querySelector(".reval-q-opt-d")?.value || "";
            const marks = parseFloat(card.querySelector(".reval-q-marks-input")?.value) || 1;
            const exp = card.querySelector(".reval-q-exp-input")?.value || "";
            const typeSel = card.querySelector(".reval-q-type-select")?.value || "mcq";

            q.statement = stmt;
            q.question_text = stmt;
            q.option_a = optA;
            q.option_b = optB;
            q.option_c = optC;
            q.option_d = optD;
            q.marks = marks;
            q.explanation = exp;
            q.type = typeSel;

            if (typeSel === "msq") {
                const checkedKeys = Array.from(card.querySelectorAll(".reval-msq-key:checked")).map(chk => chk.value).sort();
                q.correct_answers = checkedKeys.length > 0 ? checkedKeys : ["A"];
                q.correct_answer = q.correct_answers.join(",");
            } else {
                const mcqVal = card.querySelector(".reval-mcq-key-select")?.value || "A";
                q.correct_answer = mcqVal;
                q.correct_answers = [mcqVal];
            }
        });
    }

    function wireFullRevalCardEvents() {
        $$(".reval-q-type-select").forEach(sel => {
            sel.addEventListener("change", (e) => {
                syncFullRevalFromDOM();
                const idx = parseInt(e.target.getAttribute("data-reval-idx"), 10);
                if (fullRevalRevisedQuestions[idx]) {
                    fullRevalRevisedQuestions[idx].type = e.target.value;
                    renderFullRevalQuestionCards();
                    updateFullRevalBadges();
                }
            });
        });

        $$(".reval-q-marks-input").forEach(inp => {
            inp.addEventListener("input", () => {
                syncFullRevalFromDOM();
                updateFullRevalBadges();
            });
        });

        $$(".reval-q-del-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                syncFullRevalFromDOM();
                const idx = parseInt(btn.getAttribute("data-reval-idx"), 10);
                if (!isNaN(idx) && fullRevalRevisedQuestions[idx]) {
                    if (fullRevalRevisedQuestions.length <= 1) {
                        showToast("An exam must have at least one question.", true);
                        return;
                    }
                    fullRevalRevisedQuestions.splice(idx, 1);
                    fullRevalRevisedQuestions.forEach((q, i) => { q.question_number = i + 1; });
                    renderFullRevalQuestionCards();
                    updateFullRevalBadges();
                    showToast("Question removed from revision draft.");
                }
            });
        });

        $$(".reval-q-move-up-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                syncFullRevalFromDOM();
                const idx = parseInt(btn.getAttribute("data-reval-idx"), 10);
                if (idx > 0) {
                    const temp = fullRevalRevisedQuestions[idx];
                    fullRevalRevisedQuestions[idx] = fullRevalRevisedQuestions[idx - 1];
                    fullRevalRevisedQuestions[idx - 1] = temp;
                    fullRevalRevisedQuestions.forEach((q, i) => { q.question_number = i + 1; });
                    renderFullRevalQuestionCards();
                    updateFullRevalBadges();
                }
            });
        });

        $$(".reval-q-move-down-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                syncFullRevalFromDOM();
                const idx = parseInt(btn.getAttribute("data-reval-idx"), 10);
                if (idx < fullRevalRevisedQuestions.length - 1) {
                    const temp = fullRevalRevisedQuestions[idx];
                    fullRevalRevisedQuestions[idx] = fullRevalRevisedQuestions[idx + 1];
                    fullRevalRevisedQuestions[idx + 1] = temp;
                    fullRevalRevisedQuestions.forEach((q, i) => { q.question_number = i + 1; });
                    renderFullRevalQuestionCards();
                    updateFullRevalBadges();
                }
            });
        });
    }

    function updateFullRevalBadges() {
        const count = fullRevalRevisedQuestions.length;
        const marksSum = fullRevalRevisedQuestions.reduce((s, q) => s + (Number(q.marks) || 1), 0);
        if ($("#fullRevalQCountBadge")) $("#fullRevalQCountBadge").textContent = `${count} Questions in Revision`;
        if ($("#fullRevalMarksSumBadge")) $("#fullRevalMarksSumBadge").textContent = `${marksSum} Total Marks`;
    }

    const fullRevalAddNewQBtn = $("#fullRevalAddNewQBtn");
    if (fullRevalAddNewQBtn) {
        fullRevalAddNewQBtn.addEventListener("click", () => {
            syncFullRevalFromDOM();
            const newNum = fullRevalRevisedQuestions.length + 1;
            fullRevalRevisedQuestions.push({
                question_number: newNum,
                id: `q_rev_${Date.now()}_${newNum}`,
                statement: "New Question Statement",
                question_text: "New Question Statement",
                option_a: "Option A text",
                option_b: "Option B text",
                option_c: "Option C text",
                option_d: "Option D text",
                correct_answer: "A",
                correct_answers: ["A"],
                marks: 1.0,
                type: "mcq",
                explanation: ""
            });
            renderFullRevalQuestionCards();
            updateFullRevalBadges();

            const container = $("#fullRevalQuestionsContainer");
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
            showToast(`Added Question ${newNum} to revision workspace.`);
        });
    }

    const fullRevalParsePdfBundleBtn = $("#fullRevalParsePdfBundleBtn");
    if (fullRevalParsePdfBundleBtn) {
        fullRevalParsePdfBundleBtn.addEventListener("click", async () => {
            const qFile = $("#fullRevalPdfQInput")?.files[0];
            const kFile = $("#fullRevalPdfKInput")?.files[0];
            const eFile = $("#fullRevalPdfEInput")?.files[0];

            if (!qFile) {
                showToast("Please select at least a Question Paper PDF.", true);
                return;
            }

            fullRevalParsePdfBundleBtn.disabled = true;
            fullRevalParsePdfBundleBtn.textContent = "⚡ Extracting 3-PDF Bundle...";

            try {
                const qText = await extractRawTextFromPdf(qFile);
                let parsedQuestions = parseQuestionsFromRawText(qText);

                if (kFile) {
                    const kText = await extractRawTextFromPdf(kFile);
                    const parsedKeys = parseAnswerKeysText(kText);
                    parsedQuestions.forEach(q => {
                        if (parsedKeys[q.question_number]) {
                            q.correct_answer = parsedKeys[q.question_number];
                            q.correct_answers = String(parsedKeys[q.question_number]).split(",").map(s => s.trim().toUpperCase());
                        }
                    });
                }

                if (eFile) {
                    const eText = await extractRawTextFromPdf(eFile);
                    const parsedExp = parseExplanationsText(eText);
                    parsedQuestions.forEach(q => {
                        if (parsedExp[q.question_number]) {
                            q.explanation = parsedExp[q.question_number];
                        }
                    });
                }

                fullRevalRevisedQuestions = parsedQuestions;
                renderFullRevalQuestionCards();
                updateFullRevalBadges();
                showToast(`✓ Auto-extracted ${parsedQuestions.length} questions from PDF bundle.`);
            } catch (err) {
                showToast("PDF parsing error: " + err.message, true);
            } finally {
                fullRevalParsePdfBundleBtn.disabled = false;
                fullRevalParsePdfBundleBtn.textContent = "⚡ Parse PDFs & Populate Below";
            }
        });
    }

    const fullRevalPreviewBtn = $("#fullRevalPreviewBtn");
    if (fullRevalPreviewBtn) {
        fullRevalPreviewBtn.addEventListener("click", async () => {
            syncFullRevalFromDOM();

            if (!fullRevalActiveExamId) {
                showToast("Please choose an examination first.", true);
                return;
            }
            if (fullRevalRevisedQuestions.length === 0) {
                showToast("Revision draft has no questions.", true);
                return;
            }

            for (let i = 0; i < fullRevalRevisedQuestions.length; i++) {
                const q = fullRevalRevisedQuestions[i];
                if (!q.statement || q.statement.trim().length < 5) {
                    showToast(`Question ${i + 1} has an empty statement.`, true);
                    return;
                }
                if (!q.option_a || !q.option_b || !q.option_c || !q.option_d) {
                    showToast(`Question ${i + 1} must have all 4 options (A-D) defined.`, true);
                    return;
                }
                const key = Array.isArray(q.correct_answers) ? q.correct_answers.join(",") : q.correct_answer;
                if (!key) {
                    showToast(`Question ${i + 1} is missing a correct answer key.`, true);
                    return;
                }
            }

            fullRevalPreviewBtn.disabled = true;
            fullRevalPreviewBtn.textContent = "⚡ Computing Diff & Cohort Simulation...";
            const footerStatus = $("#fullRevalFooterStatus");
            if (footerStatus) footerStatus.textContent = "Simulating cohort-wide re-evaluation with deterministic sets...";

            try {
                const totalMarks = fullRevalRevisedQuestions.reduce((s, q) => s + (Number(q.marks) || 1), 0);
                const res = await adminFetch("/api/admin/revalidation/full-exam-preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        examId: fullRevalActiveExamId,
                        revisedQuestions: fullRevalRevisedQuestions,
                        totalMarks: totalMarks,
                        reason: "Complete exam-wide curriculum and key audit."
                    })
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Failed to preview full exam revalidation.");
                }

                fullRevalPreviewData = await res.json();
                renderFullRevalPreviewUI(fullRevalPreviewData);
                showToast(`Simulation complete: ${fullRevalPreviewData.affectedStudentsCount} candidate(s) score-impacted.`);
            } catch (err) {
                showToast("Preview error: " + err.message, true);
            } finally {
                fullRevalPreviewBtn.disabled = false;
                fullRevalPreviewBtn.textContent = "⚡ Validate & Preview Full Exam Impact →";
                if (footerStatus) footerStatus.textContent = "Diff preview ready.";
            }
        });
    }

    function renderFullRevalPreviewUI(data) {
        const setupSec = $("#fullRevalSetupSection");
        const prevSec = $("#fullRevalPreviewSection");
        if (setupSec) setupSec.style.display = "none";
        if (prevSec) prevSec.style.display = "block";

        if ($("#fullRevalDiffQCount")) $("#fullRevalDiffQCount").textContent = `${data.originalTotalQuestions} → ${data.revisedTotalQuestions}`;
        if ($("#fullRevalDiffTotalMarks")) $("#fullRevalDiffTotalMarks").textContent = `${data.originalTotalMarks} → ${data.revisedTotalMarks}`;
        if ($("#fullRevalDiffModifiedCount")) $("#fullRevalDiffModifiedCount").textContent = data.modifiedQuestionsCount || 0;
        if ($("#fullRevalDiffAffectedCount")) $("#fullRevalDiffAffectedCount").textContent = data.affectedStudentsCount || 0;

        const diffTbody = $("#fullRevalQuestionsDiffTbody");
        if (diffTbody) {
            diffTbody.innerHTML = (data.diffs || []).map(d => {
                let badgeColor = "#64748b";
                let badgeBg = "#f1f5f9";
                if (d.status === "MODIFIED") { badgeColor = "#b45309"; badgeBg = "#fef3c7"; }
                else if (d.status === "ADDED") { badgeColor = "#15803d"; badgeBg = "#dcfce7"; }
                else if (d.status === "REMOVED") { badgeColor = "#b91c1c"; badgeBg = "#fee2e2"; }

                return `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:6px 10px; font-weight:700;">Q${d.questionNumber}</td>
                        <td style="padding:6px 10px;"><span style="padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700; color:${badgeColor}; background:${badgeBg};">${d.status}</span></td>
                        <td style="padding:6px 10px; text-transform:uppercase; font-size:11px; color:#475569;">${d.revisedType || d.originalType || "MCQ"}</td>
                        <td style="padding:6px 10px; text-align:center; font-family:'Space Grotesk',monospace; color:#64748b;">${d.originalKey || "—"}</td>
                        <td style="padding:6px 10px; text-align:center; font-family:'Space Grotesk',monospace; font-weight:700; color:#0f172a;">${d.revisedKey || "—"}</td>
                        <td style="padding:6px 10px; text-align:right; font-weight:600;">${d.revisedMarks}</td>
                    </tr>
                `;
            }).join("");
        }

        const cohortTbody = $("#fullRevalCohortImpactTbody");
        if (cohortTbody) {
            const students = data.cohortImpact || [];
            if (students.length === 0) {
                cohortTbody.innerHTML = `<tr><td colspan="7" style="padding:16px; text-align:center; color:#64748b;">No candidate attempts submitted for this examination.</td></tr>`;
            } else {
                cohortTbody.innerHTML = students.map(s => {
                    let deltaBadge = `<span style="padding:2px 8px; border-radius:12px; font-weight:700; background:#f1f5f9; color:#64748b;">0.00</span>`;
                    let outcomeBadge = `<span style="color:#64748b; font-weight:600;">UNCHANGED</span>`;
                    if (s.delta > 0) {
                        deltaBadge = `<span style="padding:2px 8px; border-radius:12px; font-weight:700; background:#dcfce7; color:#15803d;">+${s.delta.toFixed(2)}</span>`;
                        outcomeBadge = `<span style="color:#15803d; font-weight:700;">IMPROVED</span>`;
                    } else if (s.delta < 0) {
                        deltaBadge = `<span style="padding:2px 8px; border-radius:12px; font-weight:700; background:#fee2e2; color:#b91c1c;">${s.delta.toFixed(2)}</span>`;
                        outcomeBadge = `<span style="color:#b91c1c; font-weight:700;">DECREASED</span>`;
                    }

                    return `
                        <tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:6px 10px; font-weight:700; font-family:'Space Grotesk',monospace;">${escapeHtml(s.rollNumber)}</td>
                            <td style="padding:6px 10px; font-weight:600;">${escapeHtml(s.studentName || "—")}</td>
                            <td style="padding:6px 10px; text-align:center;"><span class="badge-pill badge-gold" style="font-size:10px;">${escapeHtml(s.assignedSet || "Set A")}</span></td>
                            <td style="padding:6px 10px; text-align:right; font-family:'Space Grotesk',monospace;">${s.previousScore !== undefined ? s.previousScore.toFixed(2) : "0.00"}</td>
                            <td style="padding:6px 10px; text-align:right; font-weight:700; color:#0f172a; font-family:'Space Grotesk',monospace;">${s.revisedScore !== undefined ? s.revisedScore.toFixed(2) : "0.00"}</td>
                            <td style="padding:6px 10px; text-align:center;">${deltaBadge}</td>
                            <td style="padding:6px 10px; text-align:center; font-size:11px;">${outcomeBadge}</td>
                        </tr>
                    `;
                }).join("");
            }
        }

        if ($("#fullRevalConfirmInput")) $("#fullRevalConfirmInput").value = "";
        const commitBtn = $("#fullRevalCommitBtn");
        if (commitBtn) {
            commitBtn.disabled = true;
            commitBtn.style.opacity = "0.5";
            commitBtn.style.cursor = "not-allowed";
        }
    }

    const fullRevalBackToEditBtn = $("#fullRevalBackToEditBtn");
    if (fullRevalBackToEditBtn) {
        fullRevalBackToEditBtn.addEventListener("click", () => {
            const setupSec = $("#fullRevalSetupSection");
            const prevSec = $("#fullRevalPreviewSection");
            if (setupSec) setupSec.style.display = "block";
            if (prevSec) prevSec.style.display = "none";
        });
    }

    const fullRevalConfirmInput = $("#fullRevalConfirmInput");
    if (fullRevalConfirmInput) {
        fullRevalConfirmInput.addEventListener("input", () => {
            const val = (fullRevalConfirmInput.value || "").trim().toUpperCase();
            const commitBtn = $("#fullRevalCommitBtn");
            if (commitBtn) {
                const isMatch = (val === "REVALIDATE FULL EXAM");
                commitBtn.disabled = !isMatch;
                commitBtn.style.opacity = isMatch ? "1" : "0.5";
                commitBtn.style.cursor = isMatch ? "pointer" : "not-allowed";
            }
        });
    }

    const fullRevalCommitBtn = $("#fullRevalCommitBtn");
    if (fullRevalCommitBtn) {
        fullRevalCommitBtn.addEventListener("click", async () => {
            if (!fullRevalPreviewData) return;
            const confirmVal = ($("#fullRevalConfirmInput")?.value || "").trim().toUpperCase();
            if (confirmVal !== "REVALIDATE FULL EXAM") {
                showToast("Please type REVALIDATE FULL EXAM to confirm.", true);
                return;
            }

            fullRevalCommitBtn.disabled = true;
            fullRevalCommitBtn.textContent = "⚡ Committing Full Exam Revalidation across Cohort...";
            const footerStatus = $("#fullRevalFooterStatus");
            if (footerStatus) footerStatus.textContent = "Incrementing exam version, committing questions and secure keys to Cloud Firestore...";

            try {
                const res = await adminFetch("/api/admin/revalidation/full-exam-execute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        operationId: fullRevalPreviewData.operationId,
                        examId: fullRevalPreviewData.examId,
                        revisedQuestions: fullRevalRevisedQuestions,
                        totalMarks: fullRevalPreviewData.revisedTotalMarks,
                        confirmationPhrase: "REVALIDATE FULL EXAM",
                        expectedAffectedCount: fullRevalPreviewData.affectedStudentsCount,
                        reason: "Complete exam-wide revision commit."
                    })
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Failed to execute complete exam revalidation.");
                }

                fullRevalLastOperationReport = await res.json();

                const setupSec = $("#fullRevalSetupSection");
                const prevSec = $("#fullRevalPreviewSection");
                const succSec = $("#fullRevalSuccessSection");
                if (setupSec) setupSec.style.display = "none";
                if (prevSec) prevSec.style.display = "none";
                if (succSec) succSec.style.display = "block";

                if ($("#fullRevalSuccessOpId")) $("#fullRevalSuccessOpId").textContent = fullRevalLastOperationReport.operationId || fullRevalPreviewData.operationId;
                if ($("#fullRevalSuccessVersion")) $("#fullRevalSuccessVersion").textContent = `v${fullRevalLastOperationReport.newVersion || 2}`;
                if ($("#fullRevalSuccessAttemptCount")) $("#fullRevalSuccessAttemptCount").textContent = fullRevalLastOperationReport.attemptsReEvaluated || 0;

                showToast(`Full Exam Revalidation successful! Version v${fullRevalLastOperationReport.newVersion} active.`);
                if (footerStatus) footerStatus.textContent = "Full exam revalidation successfully committed.";

                await loadExams();
                await loadRevalidationRequests();
            } catch (err) {
                showToast("Commit error: " + err.message, true);
                fullRevalCommitBtn.disabled = false;
                fullRevalCommitBtn.textContent = "⚡ Confirm & Commit Full Exam Revalidation";
                if (footerStatus) footerStatus.textContent = "Commit halted.";
            }
        });
    }

    const downloadFullRevalReportBtn = $("#downloadFullRevalReportBtn");
    if (downloadFullRevalReportBtn) {
        downloadFullRevalReportBtn.addEventListener("click", () => {
            if (!fullRevalPreviewData) {
                showToast("No report data available.", true);
                return;
            }

            const cohort = fullRevalPreviewData.cohortImpact || [];
            const reportRows = cohort.map(s => ({
                "Operation ID": fullRevalPreviewData.operationId,
                "Exam ID": fullRevalPreviewData.examId,
                "Exam Title": fullRevalPreviewData.examTitle || "Examination",
                "Exam Version": (fullRevalLastOperationReport && fullRevalLastOperationReport.newVersion) ? `v${fullRevalLastOperationReport.newVersion}` : "v2",
                "Roll Number": s.rollNumber,
                "Student Name": s.studentName,
                "Branch": s.branch || "Information Technology",
                "Assigned Set": s.assignedSet || "Set A",
                "Previous Marks": s.previousScore,
                "Revised Marks": s.revisedScore,
                "Score Delta": s.delta > 0 ? `+${s.delta}` : `${s.delta}`,
                "Total Exam Marks": fullRevalPreviewData.revisedTotalMarks,
                "Pass/Fail Outcome": s.passFailStatus || "PASS",
                "Revalidated At": new Date().toISOString()
            }));

            const fileBase = sanitizeFileName(fullRevalPreviewData.examTitle || "Full_Exam_Revalidation");
            exportToExcel(reportRows, `${fileBase}_Full_Revalidation_Report.xlsx`, "Full Exam Revalidation");
        });
    }

    // Global Admin Interface for Cross-Module Dispatch
    window.KitsAdmin = {
        loadLiveMonitoring,
        loadCompletedExams,
        loadRevalidationRequests,
        loadStudents,
        loadExams,
        switchView
    };

    // =========================================================================
    // 10. INITIAL BOOTSTRAP (AUTHENTICATION-GUARDED)
    // =========================================================================
    verifyAdminSessionAndStart();

})();
