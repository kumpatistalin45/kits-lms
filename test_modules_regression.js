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

async function runRegression() {
    console.log("===============================================================================");
    console.log("  KITS LMS — 4-MODULE REGRESSION VERIFICATION SUITE");
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

    // 1. Authenticate Admin
    const loginRes = await makeRequest("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { username: "IT", password: "INFORMATIONTECHNOLOGY" }
    });
    const token = loginRes.body.token;
    assert("Admin authentication successful", !!token);

    // 2. Module 1: Course Management
    console.log("\n--- Module 1: Course Management ---");
    const coursesRes = await makeRequest("/api/admin/courses", {
        headers: { "Authorization": `Bearer ${token}` }
    });
    assert("Fetch courses list (HTTP 200)", coursesRes.status === 200 && Array.isArray(coursesRes.body.courses));

    const testCourseId = "test_course_" + Date.now();
    const saveCourseRes = await makeRequest("/api/admin/courses/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: {
            id: testCourseId,
            name: "Cloud Architecture & DevOps",
            department: "Information Technology",
            instructor: "Dr. K. Ramesh",
            level: "Intermediate",
            duration: "45 Hours",
            description: "Production cloud deployments.",
            is_active: true
        }
    });
    assert("Create course (HTTP 200)", saveCourseRes.status === 200 && saveCourseRes.body.success === true);

    const toggleCourseRes = await makeRequest("/api/admin/courses/toggle-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: { courseId: testCourseId }
    });
    assert("Toggle course status (HTTP 200)", toggleCourseRes.status === 200 && toggleCourseRes.body.course.is_active === false);

    // 3. Module 2: Students List
    console.log("\n--- Module 2: Students List (Roll Number Primary Key) ---");
    const studentsRes = await makeRequest("/api/admin/students", {
        headers: { "Authorization": `Bearer ${token}` }
    });
    assert("Fetch students list (HTTP 200)", studentsRes.status === 200 && Array.isArray(studentsRes.body.students));

    const testRoll = "22IT" + Math.floor(100 + Math.random() * 899);
    const saveStudentRes = await makeRequest("/api/admin/students/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: {
            roll_number: testRoll,
            name: "N. Sai Teja",
            email: "22it999@kits.edu",
            department: "Information Technology",
            academic_year: "3rd Year B.Tech",
            isEdit: false
        }
    });
    assert("Create student with roll number (HTTP 200)", saveStudentRes.status === 200 && saveStudentRes.body.success === true);

    // Duplicate roll number rejection (HTTP 409)
    const duplicateStudentRes = await makeRequest("/api/admin/students/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: {
            roll_number: testRoll,
            name: "Another Name",
            email: "another@kits.edu",
            department: "Computer Science",
            academic_year: "3rd Year B.Tech",
            isEdit: false
        }
    });
    assert("Reject duplicate student roll number (HTTP 409 Conflict)", duplicateStudentRes.status === 409);

    // 4. Module 3: Exam Results
    console.log("\n--- Module 3: Exam Results (Strict Exam Isolation) ---");
    const examsRes = await makeRequest("/api/admin/exams", {
        headers: { "Authorization": `Bearer ${token}` }
    });
    assert("Fetch exam catalog (HTTP 200)", examsRes.status === 200 && Array.isArray(examsRes.body.examinations));

    const firstExamId = examsRes.body.examinations[0].id;
    const resultsRes = await makeRequest(`/api/admin/results?examId=${encodeURIComponent(firstExamId)}`, {
        headers: { "Authorization": `Bearer ${token}` }
    });
    assert("Fetch results for specific exam (HTTP 200)", resultsRes.status === 200 && Array.isArray(resultsRes.body.results));

    // Verify all returned results match requested examId
    const allMatch = resultsRes.body.results.every(r => r.examId === firstExamId);
    assert("Strict exam isolation preserved across results", allMatch);

    // 5. Module 4: Excel Downloads & SheetJS
    console.log("\n--- Module 4: Excel Downloads Hub & Export Engine ---");
    const dashHtml = fs.readFileSync(path.join(__dirname, "admin-dashboard.html"), "utf8");
    const adminJs = fs.readFileSync(path.join(__dirname, "admin.js"), "utf8");

    assert("SheetJS CDN included in admin-dashboard.html", dashHtml.includes("xlsx.full.min.js"));
    assert("Excel export helper defined in admin.js", adminJs.includes("function exportToExcel(") && adminJs.includes("XLSX.writeFile("));
    assert("Downloads view markup present in admin-dashboard.html", dashHtml.includes("id=\"view-downloads\""));

    console.log("\n===============================================================================");
    console.log(`  REGRESSION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log("===============================================================================\n");

    if (failed > 0) process.exit(1);
}

runRegression().catch(err => {
    console.error("Regression failed:", err);
    process.exit(1);
});
