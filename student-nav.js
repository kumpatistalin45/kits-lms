/**
 * KITS LMS — Shared Student Navigation & Session Manager
 * Powered by Production Backend Service Layer (Firebase & Supabase)
 * Premium Modern White Theme
 */

(function () {
    "use strict";

    // 1. Session check & authentication verification
    const currentPath = window.location.pathname.toLowerCase();
    const isPublicPage = currentPath.endsWith("auth.html") || 
                         currentPath.endsWith("admin-login.html") || 
                         currentPath.endsWith("admin-dashboard.html");

    // Fetch session from backend service or local session storage
    let session = null;
    if (window.KitsBackend && typeof window.KitsBackend.getCurrentSession === "function") {
        session = window.KitsBackend.getCurrentSession();
    }
    if (!session) {
        try {
            session = JSON.parse(localStorage.getItem("kits_lms_auth_session") || "null");
        } catch (e) {
            session = null;
        }
    }

    // Legacy fallback check
    const legacyRoll = localStorage.getItem("mocklab_roll");
    if (!session && legacyRoll) {
        session = {
            roll: legacyRoll,
            name: localStorage.getItem("mocklab_name") || legacyRoll,
            email: localStorage.getItem("mocklab_email") || (legacyRoll.toLowerCase() + "@kits.edu"),
            dept: localStorage.getItem("mocklab_dept") || "Information Technology",
            academicYear: localStorage.getItem("mocklab_year") || "3rd Year B.Tech",
            role: "student"
        };
    }

    if (!session && !isPublicPage) {
        // Redirect unauthenticated student to login portal
        window.location.href = "auth.html";
        return;
    }

    const roll = (session && session.roll) || "Student";
    const name = (session && session.name) || roll;
    const email = (session && session.email) || "";
    const dept = (session && session.dept) || "Information Technology";
    const year = (session && session.academicYear) || "3rd Year B.Tech";
    
    const initials = (name || "ST")
        .split(" ")
        .filter(Boolean)
        .map(w => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

    // 2. Active Page Detection
    let activeKey = "dashboard";
    if (currentPath.includes("courses.html") || currentPath.includes("course-details.html")) {
        activeKey = "courses";
    } else if (currentPath.includes("results.html")) {
        activeKey = "results";
    } else if (currentPath.includes("profile.html")) {
        activeKey = "profile";
    }

    // 3. Navigation SVG Icons
    const icons = {
        dashboard: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>`,
        courses: `<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
        results: `<svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
        profile: `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        logout: `<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
        menu: `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`
    };

    function renderSidebar() {
        const sidebar = document.getElementById("studentSidebar");
        if (!sidebar) return;

        sidebar.className = "student-sidebar";
        sidebar.innerHTML = `
            <div class="sidebar-brand">
                <div class="brand-icon">KL</div>
                <div>
                    <div class="brand-text">KITS <span>LMS</span></div>
                </div>
                <span class="brand-role">STUDENT</span>
            </div>

            <nav class="sidebar-nav">
                <span class="nav-section-title">Examination Portal</span>
                <a href="dashboard.html" class="nav-link ${activeKey === "dashboard" ? "active" : ""}">
                    ${icons.dashboard}
                    <span>Dashboard</span>
                </a>
                <a href="dashboard.html#assigned-exams" class="nav-link ${activeKey === "exams" ? "active" : ""}">
                    ${icons.courses}
                    <span>My Examinations</span>
                </a>
                <a href="results.html" class="nav-link ${activeKey === "results" ? "active" : ""}">
                    ${icons.results}
                    <span>Results</span>
                </a>
            </nav>

            <div class="sidebar-footer">
                <a href="profile.html" class="sidebar-profile" title="View Profile">
                    <div class="user-avatar">${initials}</div>
                    <div class="user-details">
                        <div class="user-name">${escapeHtml(name)}</div>
                        <div class="user-roll">${escapeHtml(roll)}</div>
                    </div>
                </a>
                <button type="button" class="btn-logout" id="sidebarLogoutBtn">
                    ${icons.logout}
                    <span>Sign Out</span>
                </button>
            </div>
        `;

        // Mobile Scrim
        let scrim = document.getElementById("sidebarScrim");
        if (!scrim) {
            scrim = document.createElement("div");
            scrim.id = "sidebarScrim";
            scrim.className = "sidebar-scrim";
            document.body.appendChild(scrim);
        }
        scrim.addEventListener("click", closeSidebar);

        const logoutBtn = document.getElementById("sidebarLogoutBtn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", logout);
        }
    }

    function renderTopbar(titleText, subtitleText) {
        const topbar = document.getElementById("studentTopbar");
        if (!topbar) return;

        topbar.className = "student-topbar";
        topbar.innerHTML = `
            <div class="topbar-left">
                <button type="button" class="mobile-menu-btn" id="mobileMenuToggle" aria-label="Toggle navigation">
                    ${icons.menu}
                </button>
                <div class="page-title-box">
                    <h1>${escapeHtml(titleText || "Student Portal")}</h1>
                    <p>${escapeHtml(subtitleText || dept)}</p>
                </div>
            </div>

            <div class="topbar-right">
                <div class="portal-tag">
                    <span class="dot"></span>
                    <span>Academic Session 2026-27</span>
                </div>
                <a href="admin-login.html" class="faculty-switch-btn" title="Faculty Admin Login">
                    Faculty Portal →
                </a>
            </div>
        `;

        const menuToggle = document.getElementById("mobileMenuToggle");
        if (menuToggle) {
            menuToggle.addEventListener("click", toggleSidebar);
        }
    }

    function toggleSidebar() {
        const sidebar = document.getElementById("studentSidebar");
        const scrim = document.getElementById("sidebarScrim");
        if (sidebar && scrim) {
            sidebar.classList.toggle("open");
            scrim.classList.toggle("open");
        }
    }

    function closeSidebar() {
        const sidebar = document.getElementById("studentSidebar");
        const scrim = document.getElementById("sidebarScrim");
        if (sidebar && scrim) {
            sidebar.classList.remove("open");
            scrim.classList.remove("open");
        }
    }

    async function logout() {
        if (confirm("Are you sure you want to sign out from KITS LMS?")) {
            if (window.KitsBackend && typeof window.KitsBackend.signOut === "function") {
                await window.KitsBackend.signOut();
            } else {
                localStorage.removeItem("kits_lms_auth_session");
                localStorage.removeItem("mocklab_roll");
                localStorage.removeItem("mocklab_name");
                localStorage.removeItem("mocklab_email");
                localStorage.removeItem("mocklab_dept");
                localStorage.removeItem("mocklab_year");
            }
            window.location.href = "auth.html";
        }
    }

    function escapeHtml(str) {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Courses retrieval from Backend
    function getCatalog() {
        const deletedIds = JSON.parse(localStorage.getItem("mocktest_deleted_course_ids") || "[]");
        const adminCourses = JSON.parse(localStorage.getItem("mocktest_courses") || "[]");
        const backendCourses = JSON.parse(localStorage.getItem("kits_lms_db_courses") || "[]");

        let map = new Map();

        // 1. Backend courses
        backendCourses.forEach(c => {
            if (!deletedIds.includes(c.id)) {
                map.set(c.id, {
                    id: c.id,
                    name: c.title || c.name,
                    instructor: c.instructor_name || c.instructor || "Faculty Instructor",
                    dept: c.department || c.dept || "Academic Dept",
                    description: c.description || "",
                    level: c.level || "Intermediate",
                    duration: c.duration || "40 Hours",
                    questions: 50
                });
            }
        });

        // 2. Admin courses
        adminCourses.forEach(ac => {
            if (!deletedIds.includes(ac.id) && !map.has(ac.id)) {
                map.set(ac.id, {
                    id: ac.id,
                    name: ac.name,
                    instructor: ac.instructor || "Faculty Instructor",
                    dept: ac.dept || "Academic Dept",
                    description: ac.description || "",
                    level: ac.level || "Intermediate",
                    duration: ac.duration || "40 Hours",
                    questions: 50
                });
            }
        });

        return Array.from(map.values());
    }

    function getEnrolledCourses() {
        try {
            return JSON.parse(localStorage.getItem("enrolledCourses") || "[]");
        } catch (e) {
            return [];
        }
    }

    function setEnrolledCourses(courses) {
        localStorage.setItem("enrolledCourses", JSON.stringify(courses));
    }

    function enrollCourse(courseId) {
        const enrolled = getEnrolledCourses();
        if (!enrolled.includes(courseId)) {
            enrolled.push(courseId);
            setEnrolledCourses(enrolled);
            if (session && session.studentId && window.KitsBackend) {
                window.KitsBackend.enrollInCourse(session.studentId, courseId);
            }
            return true;
        }
        return false;
    }

    function getPublishedTests(courseId) {
        try {
            const allTests = JSON.parse(localStorage.getItem("mocktest_tests") || "[]");
            let tests = allTests.filter(t => (!courseId || t.courseId === courseId) && t.status === "published");

            // Also check kits_lms_db_examinations from backend
            const dbExams = JSON.parse(localStorage.getItem("kits_lms_db_examinations") || "[]");
            dbExams.filter(e => e.status === "published" && (!courseId || e.course_id === courseId)).forEach(e => {
                if (!tests.some(t => String(t.id) === String(e.id))) {
                    tests.push({
                        id: e.id,
                        courseId: e.course_id,
                        name: e.title,
                        questionCount: 34,
                        duration: e.duration_minutes || 90,
                        totalMarks: e.total_marks || 50,
                        setCount: e.set_count || 10,
                        attemptsAllowed: 1,
                        status: "published"
                    });
                }
            });

            return tests;
        } catch (e) {
            return [];
        }
    }

    function getStudentAttempts() {
        try {
            const results = JSON.parse(localStorage.getItem("kits_lms_db_results") || "[]");
            const legacyAttempts = JSON.parse(localStorage.getItem("mocklab_attempts") || "[]");

            let matched = [];
            // Match from results
            results.filter(r => (r.student_id === (session && session.studentId)) || (r.student_id === roll)).forEach(r => {
                matched.push({
                    id: r.id,
                    attemptId: r.attempt_id,
                    testName: r.testName || "Examination",
                    score: r.score,
                    total: r.total_marks || 50,
                    percentage: r.percentage,
                    date: r.completed_at
                });
            });

            // Match from legacy attempts
            legacyAttempts.filter(a => (a.userId || a.roll) === roll || a.userId === (session && session.studentId)).forEach(a => {
                if (!matched.some(m => m.id === a.id)) {
                    matched.push(a);
                }
            });

            return matched;
        } catch (e) {
            return [];
        }
    }

    // Expose global KITS LMS Student API
    window.KitsLMS = {
        getStudent: () => ({ roll, name, email, dept, year, initials }),
        renderSidebar,
        renderTopbar,
        toggleSidebar,
        closeSidebar,
        logout,
        getCatalog,
        getEnrolledCourses,
        setEnrolledCourses,
        enrollCourse,
        getPublishedTests,
        getStudentAttempts,
        escapeHtml
    };
})();
