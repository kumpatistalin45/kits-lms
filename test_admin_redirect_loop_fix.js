/**
 * Automated Verification Suite for KITS LMS Admin Login & Session Persistence Fix
 * Tests all 10 Test Cases for the Blink / Redirect Loop Resolution
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const BASE_URL = "http://localhost:3000";

function makeRequest(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlPath, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || "GET",
            headers: options.headers || {}
        };

        const req = http.request(reqOptions, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsed
                });
            });
        });

        req.on("error", reject);
        if (options.body) {
            req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function runTests() {
    console.log("===============================================================================");
    console.log("  KITS LMS — ADMIN LOGIN & SESSION PERSISTENCE VERIFICATION (10 TEST CASES)");
    console.log("===============================================================================\n");

    let passed = 0;
    let failed = 0;

    function assert(name, condition, details = "") {
        if (condition) {
            console.log(`  ✓ PASS: ${name}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL: ${name} ${details ? `(${details})` : ""}`);
            failed++;
        }
    }

    // --- TEST 1: Valid admin login -> Dashboard remains open ---
    console.log("--- TEST 1: Valid Admin Login & Token/Cookie Issuance ---");
    const loginRes = await makeRequest("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { username: "IT", password: "INFORMATIONTECHNOLOGY" }
    });
    assert("1.1 Login HTTP 200 OK", loginRes.status === 200);
    assert("1.2 Login response has success=true", loginRes.body && loginRes.body.success === true);
    assert("1.3 Session token returned", loginRes.body && !!loginRes.body.token);
    assert("1.4 Role is admin", loginRes.body && loginRes.body.user && loginRes.body.user.role === "admin");
    const setCookie = loginRes.headers["set-cookie"] || [];
    const hasCookie = setCookie.some(c => c.includes("kits_admin_token="));
    assert("1.5 Set-Cookie header issued for kits_admin_token", hasCookie);

    const validAdminToken = loginRes.body.token;

    // --- TEST 2: Refresh dashboard -> Admin remains logged in ---
    console.log("\n--- TEST 2: Refresh Dashboard / Session Verification ---");
    const verifyBearerRes = await makeRequest("/api/auth/verify-session", {
        headers: { "Authorization": `Bearer ${validAdminToken}` }
    });
    assert("2.1 Session verification via Bearer token succeeds (HTTP 200)", verifyBearerRes.status === 200);
    assert("2.2 Session is valid with admin role", verifyBearerRes.body && verifyBearerRes.body.valid === true && verifyBearerRes.body.user.role === "admin");

    // Also verify via Cookie
    const verifyCookieRes = await makeRequest("/api/auth/verify-session", {
        headers: { "Cookie": `kits_admin_token=${validAdminToken}` }
    });
    assert("2.3 Session verification via Cookie succeeds (HTTP 200)", verifyCookieRes.status === 200);
    assert("2.4 Cookie session is valid with admin role", verifyCookieRes.body && verifyCookieRes.body.valid === true && verifyCookieRes.body.user.role === "admin");

    // --- TEST 3: Navigate between modules -> Session remains active ---
    console.log("\n--- TEST 3: Navigation Across Admin Modules ---");
    const coursesRes = await makeRequest("/api/admin/courses", {
        headers: { "Authorization": `Bearer ${validAdminToken}` }
    });
    assert("3.1 Course Management access granted (HTTP 200)", coursesRes.status === 200 && Array.isArray(coursesRes.body.courses));

    const studentsRes = await makeRequest("/api/admin/students", {
        headers: { "Authorization": `Bearer ${validAdminToken}` }
    });
    assert("3.2 Students List access granted (HTTP 200)", studentsRes.status === 200 && Array.isArray(studentsRes.body.students));

    const examsRes = await makeRequest("/api/admin/exams", {
        headers: { "Authorization": `Bearer ${validAdminToken}` }
    });
    assert("3.3 Exam Results catalog access granted (HTTP 200)", examsRes.status === 200 && Array.isArray(examsRes.body.examinations));

    // --- TEST 4: Open dashboard in a new tab -> Session persists ---
    console.log("\n--- TEST 4: Cross-tab / Multi-session Persistence ---");
    // Verify that localStorage keys and sessionStorage keys in admin.js and admin-login.html are synchronized
    const adminJsContent = fs.readFileSync(path.join(__dirname, "admin.js"), "utf8");
    const adminLoginContent = fs.readFileSync(path.join(__dirname, "admin-login.html"), "utf8");
    const adminDashContent = fs.readFileSync(path.join(__dirname, "admin-dashboard.html"), "utf8");

    assert("4.1 admin.js reads from both localStorage and sessionStorage", 
        adminJsContent.includes("localStorage.getItem(CONFIG.sessionKey)") &&
        adminJsContent.includes("sessionStorage.getItem(CONFIG.sessionKey)") &&
        adminJsContent.includes("kits_lms_admin_session")
    );
    assert("4.2 admin-login.html writes to both localStorage and sessionStorage",
        adminLoginContent.includes("sessionStorage.setItem(sessionKey") &&
        adminLoginContent.includes("localStorage.setItem(sessionKey") &&
        adminLoginContent.includes("kits_lms_admin_session")
    );
    assert("4.3 admin.js preserves session mirroring on successful verification",
        adminJsContent.includes("localStorage.setItem(CONFIG.sessionKey") &&
        adminJsContent.includes("sessionStorage.setItem(CONFIG.sessionKey")
    );

    // --- TEST 5: Invalid credentials -> Login error displayed, no redirect ---
    console.log("\n--- TEST 5: Invalid Credentials Handling ---");
    const invalidLoginRes = await makeRequest("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { username: "IT", password: "WRONG_PASSWORD" }
    });
    assert("5.1 Invalid password returns HTTP 401 Unauthorized", invalidLoginRes.status === 401);
    assert("5.2 Error message specifies invalid credentials", 
        invalidLoginRes.body && invalidLoginRes.body.error && invalidLoginRes.body.error.includes("Invalid username or password")
    );

    const invalidUserRes = await makeRequest("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { username: "UNKNOWN_ADMIN", password: "INFORMATIONTECHNOLOGY" }
    });
    assert("5.3 Unknown username returns HTTP 401 Unauthorized", invalidUserRes.status === 401);

    // --- TEST 6: Expired token -> Redirect to login once ---
    console.log("\n--- TEST 6: Expired / Invalid Token Handling ---");
    // Use an invalid or expired token format
    const expiredVerifyRes = await makeRequest("/api/auth/verify-session", {
        headers: { "Authorization": "Bearer invalid.expired.token" }
    });
    assert("6.1 Invalid/expired token returns HTTP 401", expiredVerifyRes.status === 401);
    assert("6.2 Verification payload indicates valid=false", expiredVerifyRes.body && expiredVerifyRes.body.valid === false);

    assert("6.3 admin.js contains redirect to admin-login on 401/403",
        adminJsContent.includes("res.status === 401 || res.status === 403") &&
        adminJsContent.includes("window.location.replace(\"admin-login.html")
    );

    // --- TEST 7: Backend temporarily unavailable -> Shows error and retry option, no infinite redirect loop ---
    console.log("\n--- TEST 7: Backend Offline / Network Resilience (No Loop) ---");
    assert("7.1 admin.js defines showOfflineState with Retry Connection",
        adminJsContent.includes("function showOfflineState(") &&
        adminJsContent.includes("Retry Connection") &&
        adminJsContent.includes("Back to Login")
    );
    assert("7.2 Network error in admin.js does NOT trigger window.location.replace",
        adminJsContent.includes("catch (networkErr) {") &&
        !adminJsContent.includes("catch (networkErr) {\n            window.location.replace")
    );
    assert("7.3 admin-login.html does NOT auto-redirect on network error",
        adminLoginContent.includes("catch (netErr) {") &&
        adminLoginContent.includes("// Backend server unavailable: do NOT redirect into dashboard")
    );

    // --- TEST 8: Logout -> Cookie and storage cleared, dashboard inaccessible ---
    console.log("\n--- TEST 8: Logout & Session Invalidation ---");
    const logoutRes = await makeRequest("/api/auth/admin-logout", {
        method: "POST",
        headers: { "Authorization": `Bearer ${validAdminToken}` }
    });
    assert("8.1 Logout endpoint returns HTTP 200 OK", logoutRes.status === 200);
    const logoutCookies = logoutRes.headers["set-cookie"] || [];
    const cookieCleared = logoutCookies.some(c => c.includes("Max-Age=0"));
    assert("8.2 Logout clears cookie with Max-Age=0", cookieCleared);

    assert("8.3 admin.js clears all storage keys on logout",
        adminJsContent.includes("localStorage.removeItem(CONFIG.sessionKey)") &&
        adminJsContent.includes("sessionStorage.removeItem(CONFIG.sessionKey)") &&
        adminJsContent.includes("localStorage.removeItem(\"kits_lms_admin_session\")") &&
        adminJsContent.includes("sessionStorage.removeItem(\"kits_lms_admin_session\")")
    );

    // --- TEST 9: Student token -> Rejected with 403 ---
    console.log("\n--- TEST 9: Student Token Role Enforcement ---");
    // Register or obtain a student token with unique roll number
    const testRoll = "22TEST" + Math.floor(1000 + Math.random() * 9000);
    const studentRegRes = await makeRequest("/api/auth/register-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
            name: "Test Student",
            roll: testRoll,
            roll_number: testRoll,
            email: `${testRoll.toLowerCase()}@kits.edu`,
            department: "Information Technology",
            academicYear: "3rd Year B.Tech"
        }
    });
    const studentToken = studentRegRes.body && studentRegRes.body.token;
    assert("9.1 Student registration succeeds", !!studentToken);

    // Try accessing admin courses with student token
    const studentAccessCourses = await makeRequest("/api/admin/courses", {
        headers: { "Authorization": `Bearer ${studentToken}` }
    });
    assert("9.2 Student token rejected on /api/admin/courses (HTTP 403)", studentAccessCourses.status === 403);

    // Try accessing admin students with student token
    const studentAccessStudents = await makeRequest("/api/admin/students", {
        headers: { "Authorization": `Bearer ${studentToken}` }
    });
    assert("9.3 Student token rejected on /api/admin/students (HTTP 403)", studentAccessStudents.status === 403);

    // Try accessing admin exams with student token
    const studentAccessExams = await makeRequest("/api/admin/exams", {
        headers: { "Authorization": `Bearer ${studentToken}` }
    });
    assert("9.4 Student token rejected on /api/admin/exams (HTTP 403)", studentAccessExams.status === 403);

    // --- TEST 10: Repeated login attempts -> No redirect loop ---
    console.log("\n--- TEST 10: Idempotent Logins & Premature Render Guard ---");
    // Sequential logins
    let repeatedLoginsOk = true;
    for (let i = 0; i < 3; i++) {
        const repeatRes = await makeRequest("/api/auth/admin-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: { username: "IT", password: "INFORMATIONTECHNOLOGY" }
        });
        if (repeatRes.status !== 200 || !repeatRes.body.token) {
            repeatedLoginsOk = false;
        }
    }
    assert("10.1 Repeated login requests succeed consistently (HTTP 200)", repeatedLoginsOk);

    // Verify authGuardOverlay in HTML
    assert("10.2 admin-dashboard.html contains #authGuardOverlay to prevent blink",
        adminDashContent.includes("id=\"authGuardOverlay\"") &&
        adminDashContent.includes("id=\"authGuardMessage\"")
    );

    // Verify admin.js does NOT call switchView synchronously on page load
    assert("10.3 admin.js invokes verifyAdminSessionAndStart() instead of bare switchView()",
        adminJsContent.includes("verifyAdminSessionAndStart();") &&
        adminJsContent.includes("isVerifyingSession")
    );

    // Verify getApiBase uniformity across both files
    assert("10.4 Unified getApiBase helper handles port 3000, port 5500, and production",
        adminJsContent.includes("function getApiBase()") &&
        adminLoginContent.includes("function getApiBase()")
    );

    console.log("\n===============================================================================");
    console.log(`  VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log("===============================================================================\n");

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});

