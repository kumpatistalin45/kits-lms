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
        if (!val) return "N/A";
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return String(val);
        return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    function sanitizeFileName(name) {
        return (name || "Export").replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/__+/g, "_");
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

        const rows = activeStudents.map(s => ({
            "Roll Number": (s.roll_number || "").toUpperCase(),
            "Student Name": s.name || s.full_name || "",
            "Email": s.email || "",
            "Branch": s.department || s.branch || "Information Technology",
            "Batch": s.academic_year || s.batch || "3rd Year B.Tech",
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
        const rows = list.map(r => {
            const roll = (r.rollNumber || r.roll_number || "").toUpperCase();
            const isDeleted = (r.isDeleted || r.accountStatus === "deleted" || r.studentStatus === "deleted" || (r.studentName && r.studentName.includes("Deactivated")));
            const studentName = isDeleted ? `[Deactivated Student - ${roll}]` : (r.studentName || r.name || "");
            const email = isDeleted ? "[Protected - Deactivated]" : (r.email || "");

            return {
                "Roll Number": roll,
                "Student Name": studentName,
                "Email": email,
                "Branch": r.branch || r.department || "Information Technology",
                "Batch": r.batch || r.academic_year || "3rd Year B.Tech",
                "Marks Obtained": (r.marksObtained !== null && r.marksObtained !== undefined) ? Number(r.marksObtained) : (r.score !== null && r.score !== undefined ? Number(r.score) : ""),
                "Total Marks": (r.marksObtained !== null && r.marksObtained !== undefined) || (r.score !== null && r.score !== undefined) ? 50 : "",
                "Percentage": (r.percentage !== null && r.percentage !== undefined) ? `${Number(r.percentage)}%` : "",
                "Start Time": r.started_at ? formatDateTime(r.started_at) : "--",
                "Submission Time": r.submitted_at ? formatDateTime(r.submitted_at) : "--",
                "Attempt Status": r.attemptStatus || r.status || "Not Attempted"
            };
        });
        const fileBase = sanitizeFileName(examTitle || "Examination");
        exportToExcel(rows, `${fileBase}_Results.xlsx`, "Results");
    }

    // =========================================================================
    // 3. NAVIGATION CONTROLLER (5 STRICT MODULES)
    // =========================================================================
    const TITLES = {
        dashboard: "Administrator Dashboard",
        exams: "Exam Management",
        students: "Students List",
        monitoring: "Exam Monitoring & Results"
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
        else if (target === "monitoring") loadMonitoring();
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
            switchView("monitoring");
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
                switchView("monitoring");
                const select = $("#monitorExamSelect");
                if (select) {
                    select.value = examId;
                    loadMonitoring();
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
                switchView("monitoring");
                const select = $("#monitorExamSelect");
                if (select) {
                    select.value = id;
                    loadMonitoring();
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
        $("#examFormDesc").value = exam ? (exam.description || "") : "Standard Assessment. No negative marking.";
        $("#examCreateStatus").textContent = "";

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

        if ($("#examQuestionsCountBadge")) $("#examQuestionsCountBadge").textContent = `${count} Questions Loaded (${totalMarks} Marks)`;
        if ($("#btnQuestionsCount")) $("#btnQuestionsCount").textContent = count;
        if ($("#examFormTotalSummary")) $("#examFormTotalSummary").value = `${count} Questions • ${totalMarks} Marks`;

        if ($("#reviewModalBadge")) $("#reviewModalBadge").textContent = `${count} Questions`;
        if ($("#reviewModalMarksBadge")) $("#reviewModalMarksBadge").textContent = `${totalMarks} Total Marks`;
        if ($("#reviewModalDurationBadge")) $("#reviewModalDurationBadge").textContent = `${duration} Minutes Duration`;
    }

    const examFormDurationInput = $("#examFormDuration");
    if (examFormDurationInput) {
        examFormDurationInput.addEventListener("input", updateQuestionsDraftUI);
    }

    // PDF Upload & Extraction Logic
    const browsePdfBtn = $("#browsePdfBtn");
    const examPdfFileInput = $("#examPdfFileInput");
    const examPdfDropzone = $("#examPdfDropzone");

    if (browsePdfBtn && examPdfFileInput) {
        browsePdfBtn.addEventListener("click", () => examPdfFileInput.click());
    }

    if (examPdfDropzone && examPdfFileInput) {
        examPdfDropzone.addEventListener("click", (e) => {
            if (e.target !== browsePdfBtn) examPdfFileInput.click();
        });
        examPdfDropzone.addEventListener("dragover", e => {
            e.preventDefault();
            examPdfDropzone.style.borderColor = "#c59b27";
            examPdfDropzone.style.background = "#fbf6ea";
        });
        examPdfDropzone.addEventListener("dragleave", () => {
            examPdfDropzone.style.borderColor = "#cbd5e1";
            examPdfDropzone.style.background = "#ffffff";
        });
        examPdfDropzone.addEventListener("drop", e => {
            e.preventDefault();
            examPdfDropzone.style.borderColor = "#cbd5e1";
            examPdfDropzone.style.background = "#ffffff";
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handlePdfUpload(e.dataTransfer.files[0]);
            }
        });
    }

    if (examPdfFileInput) {
        examPdfFileInput.addEventListener("change", e => {
            if (e.target.files && e.target.files[0]) {
                handlePdfUpload(e.target.files[0]);
            }
        });
    }

    let selectedPdfFile = null;

    async function handlePdfUpload(file) {
        if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
            showToast("Please upload a valid PDF file.", true);
            return;
        }

        selectedPdfFile = file;
        const infoEl = $("#selectedPdfInfo");
        const nameEl = $("#selectedPdfName");
        const statusEl = $("#examPdfStatus");

        if (infoEl) infoEl.classList.remove("hidden");
        if (nameEl) nameEl.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        if (statusEl) statusEl.textContent = "Ready to extract questions from PDF.";
    }

    const removePdfBtn = $("#removePdfBtn");
    if (removePdfBtn) {
        removePdfBtn.addEventListener("click", () => {
            selectedPdfFile = null;
            if ($("#selectedPdfInfo")) $("#selectedPdfInfo").classList.add("hidden");
            if ($("#examPdfFileInput")) $("#examPdfFileInput").value = "";
            if ($("#examPdfStatus")) $("#examPdfStatus").textContent = "";
        });
    }

    const extractPdfQuestionsBtn = $("#extractPdfQuestionsBtn");
    if (extractPdfQuestionsBtn) {
        extractPdfQuestionsBtn.addEventListener("click", async () => {
            if (!selectedPdfFile) return;
            const statusEl = $("#examPdfStatus");
            if (statusEl) statusEl.textContent = "Extracting questions via PDF.js & OCR...";

            try {
                const extracted = await extractQuestionsFromPdfFile(selectedPdfFile);
                if (extracted.length > 0) {
                    currentQuestionsDraft = extracted;
                    updateQuestionsDraftUI();
                    if (statusEl) statusEl.textContent = `✓ Successfully extracted ${extracted.length} questions from PDF! You can now edit, add, or delete questions.`;
                    showToast(`Extracted ${extracted.length} questions from PDF.`);
                } else {
                    if (statusEl) statusEl.textContent = "Could not parse distinct questions from PDF. Standard question bank retained.";
                }
            } catch (err) {
                if (statusEl) statusEl.textContent = "PDF extraction error: " + err.message;
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

            if (!title || !date || !time) {
                $("#examCreateStatus").textContent = "Please fill in Examination Title, Date, and Start Time.";
                return;
            }

            const val = validateQuestionsDraft(currentQuestionsDraft);
            if (!val.valid) {
                $("#examCreateStatus").textContent = val.message;
                showToast(val.message, true);
                return;
            }

            $("#examCreateStatus").textContent = "Scheduling examination and validating questions...";

            const questionsToSave = currentQuestionsDraft;
            const totalQuestions = questionsToSave.length;
            const totalMarks = questionsToSave.reduce((s, q) => s + (Number(q.marks) || 1), 0);

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
                        total_questions: totalQuestions,
                        total_marks: totalMarks,
                        status: "published",
                        questions: questionsToSave
                    })
                });

                if (res.ok) {
                    setModal($("#examCreateModal"), false);
                    showToast(`Examination '${title}' scheduled & published successfully!`);
                    await loadExams();
                } else {
                    const err = await res.json();
                    $("#examCreateStatus").textContent = err.error || "Failed to save examination.";
                }
            } catch (err) {
                $("#examCreateStatus").textContent = "Network error: " + err.message;
            }
        });
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
            const yearMatch = !yearVal || (s.academic_year || s.batch) === yearVal;
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
        if (el) el.addEventListener("input", renderStudentsTable);
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
    // 7. MODULE 4: EXAM MONITORING & RESULTS (EXAM ISOLATION)
    // =========================================================================
    let activeMonitoringExam = null;
    let activeCandidateRoster = [];

    async function loadMonitoring() {
        if (allExamsList.length === 0) {
            await loadExams();
        }

        const select = $("#monitorExamSelect");
        if (select) {
            const currentVal = select.value;
            select.innerHTML = allExamsList.map(e => 
                `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title || e.name)}</option>`
            ).join("");

            if (currentVal && allExamsList.some(e => e.id === currentVal)) {
                select.value = currentVal;
            } else if (allExamsList.length > 0) {
                select.value = allExamsList[0].id;
            }
        }

        const selectedExamId = select ? select.value : "";
        if (!selectedExamId) return;

        try {
            const res = await adminFetch(`/api/admin/exams/monitoring?examId=${encodeURIComponent(selectedExamId)}`);
            if (res.ok) {
                const data = await res.json();
                activeMonitoringExam = data.exam;
                activeCandidateRoster = data.candidates || [];

                if (data.counts) {
                    if ($("#statMonRegistered")) $("#statMonRegistered").textContent = data.counts.totalRegistered || data.counts.totalAssigned || 0;
                    if ($("#statMonEligible")) $("#statMonEligible").textContent = data.counts.totalEligible || 0;
                    if ($("#statMonSubmitted")) $("#statMonSubmitted").textContent = data.counts.submitted || 0;
                    if ($("#statMonAbsent")) $("#statMonAbsent").textContent = data.counts.absent || 0;
                    if ($("#statMonAssigned")) $("#statMonAssigned").textContent = data.counts.totalAssigned || 0;
                    if ($("#statMonInProgress")) $("#statMonInProgress").textContent = data.counts.inProgress || 0;
                }
            }
        } catch (err) {
            console.warn("[MONITOR-FETCH-ERROR]", err.message);
        }

        renderMonitoringTable();
    }

    const monitorExamSelect = $("#monitorExamSelect");
    if (monitorExamSelect) {
        monitorExamSelect.addEventListener("change", () => loadMonitoring());
    }

    function renderMonitoringTable() {
        const tbody = $("#monitorTableBody");
        if (!tbody) return;

        const searchVal = ($("#monitorCandidateSearch")?.value || "").trim().toLowerCase();
        const statusVal = ($("#monitorStatusFilter")?.value || "").trim();

        const filtered = activeCandidateRoster.filter(c => {
            const roll = (c.roll_number || c.rollNumber || "").toLowerCase();
            const name = (c.name || c.studentName || "").toLowerCase();
            const matchSearch = !searchVal || roll.includes(searchVal) || name.includes(searchVal);
            const matchStatus = !statusVal || c.status === statusVal || c.attemptStatus === statusVal;
            return matchSearch && matchStatus;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="table-empty">No candidate records match active search or filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(c => {
            let statusBadge = "badge-blue";
            const st = c.status || c.attemptStatus || "Not Started";
            if (st === "Submitted") statusBadge = "badge-green";
            else if (st === "Auto Submitted") statusBadge = "badge-gold";
            else if (st === "Absent") statusBadge = "badge-suspended";
            else if (st === "Not Started") statusBadge = "badge-purple";
            else if (st.includes("Suspended")) statusBadge = "badge-suspended";

            const marksObtained = c.marksObtained !== null && c.marksObtained !== undefined ? c.marksObtained : (c.score !== null && c.score !== undefined ? c.score : null);
            const scoreDisplay = marksObtained !== null ? `<strong>${marksObtained}</strong>` : "—";
            const pctDisplay = c.percentage !== null && c.percentage !== undefined ? `${c.percentage}%` : "—";

            return `
                <tr>
                    <td><strong>${escapeHtml(c.roll_number || c.rollNumber)}</strong></td>
                    <td>${escapeHtml(c.studentName || c.name || "—")}</td>
                    <td>${escapeHtml(c.email || "—")}</td>
                    <td>${escapeHtml(c.branch || c.department || "Information Technology")}</td>
                    <td>${escapeHtml(c.batch || c.academic_year || "3rd Year B.Tech")}</td>
                    <td>${scoreDisplay}</td>
                    <td>${marksObtained !== null ? "50" : "—"}</td>
                    <td>${pctDisplay}</td>
                    <td>${c.started_at ? escapeHtml(formatDateTime(c.started_at)) : "—"}</td>
                    <td>${c.submitted_at ? escapeHtml(formatDateTime(c.submitted_at)) : "—"}</td>
                    <td><span class="badge-pill ${statusBadge}">${escapeHtml(st)}</span></td>
                </tr>
            `;
        }).join("");
    }

    ["#monitorCandidateSearch", "#monitorStatusFilter"].forEach(sel => {
        const el = $(sel);
        if (el) el.addEventListener("input", renderMonitoringTable);
    });

    const exportMonitoringExcelBtn = $("#exportMonitoringExcelBtn");
    if (exportMonitoringExcelBtn) {
        exportMonitoringExcelBtn.addEventListener("click", () => {
            if (!activeMonitoringExam) return;
            const attemptedOnly = $("#excelAttemptedOnly") ? $("#excelAttemptedOnly").checked : false;
            exportExamResultsRoster(activeMonitoringExam.title || "Exam", activeCandidateRoster, attemptedOnly);
        });
    }

    // =========================================================================
    // 8. INITIAL BOOTSTRAP (AUTHENTICATION-GUARDED)
    // =========================================================================
    verifyAdminSessionAndStart();

})();
