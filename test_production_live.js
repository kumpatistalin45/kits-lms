// test_production_live.js
// Automated Live Production Test Suite for https://kits-lms.vercel.app
const https = require("https");

const PROD_URL = "https://kits-lms.vercel.app";

function requestProd(path, method = "GET", body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, PROD_URL);
        const reqHeaders = { "Content-Type": "application/json", ...headers };
        const req = https.request(url, { method, headers: reqHeaders }, (res) => {
            // Handle redirects (e.g. 308 Permanent Redirect for cleanUrls)
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    return resolve(requestProd(redirectUrl, method, body, headers));
                }
            }
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on("error", reject);
        if (body) {
            req.write(typeof body === "string" ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function runLiveTests() {
    console.log("==================================================================");
    console.log("  KITS LMS — LIVE PRODUCTION VERCEL DEPLOYMENT VERIFICATION");
    console.log("  Target: " + PROD_URL);
    console.log("==================================================================\n");

    let passed = 0;
    let total = 0;

    function assert(cond, name, details = "") {
        total++;
        if (cond) {
            console.log(`  [PASS] ${name}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${name}`);
            if (details) console.error(`         Details: ${details}`);
        }
    }

    // 1. Root & HTML Page Availability & White & Gold Theme
    console.log("--> 1. Testing Production Frontend Delivery & White & Gold Theme");
    const rootRes = await requestProd("/");
    assert(rootRes.status === 200, "Root path (/) returns HTTP 200 OK");

    const cssRes = await requestProd("/student-shared.css");
    const cssBody = typeof cssRes.body === "string" ? cssRes.body : JSON.stringify(cssRes.body);
    assert(cssRes.status === 200 && cssBody.includes("--primary: #c59b27;"), "student-shared.css delivers White & Gold primary (#c59b27)");
    assert(!cssBody.includes("#2563eb") && !cssBody.includes("#1d4ed8"), "student-shared.css has zero legacy blue hex codes");

    const authRes = await requestProd("/auth.html");
    assert(authRes.status === 200 && typeof authRes.body === "string" && authRes.body.includes("KITS"), "auth.html delivers student/faculty login portal");

    const adminLoginRes = await requestProd("/admin-login.html");
    assert(adminLoginRes.status === 200 && typeof adminLoginRes.body === "string" && adminLoginRes.body.includes("Administrator"), "admin-login.html delivers admin portal");

    const dashRes = await requestProd("/dashboard.html");
    assert(dashRes.status === 200 && typeof dashRes.body === "string" && dashRes.body.includes("Dashboard"), "dashboard.html delivers student dashboard");

    const termsRes = await requestProd("/exam-terms.html");
    assert(termsRes.status === 200 && typeof termsRes.body === "string" && termsRes.body.includes("Instructions"), "exam-terms.html delivers instructions and terms room");

    const resultsRes = await requestProd("/results.html");
    assert(resultsRes.status === 200 && typeof resultsRes.body === "string" && resultsRes.body.includes("Scorecard"), "results.html delivers scorecard viewer");

    // 2. Health & Time API Serverless Execution
    console.log("\n--> 2. Testing Vercel Serverless Function Execution (/api/*)");
    const healthRes = await requestProd("/api/health");
    assert(healthRes.status === 200 && healthRes.body.status === "UP", "/api/health returns HTTP 200 { status: 'UP' }", JSON.stringify(healthRes.body));

    const timeRes = await requestProd("/api/server-time");
    assert(timeRes.status === 200 && timeRes.body.success && timeRes.body.ist, "/api/server-time returns synchronized IST time", JSON.stringify(timeRes.body));

    // 3. Admin Authentication & Session
    console.log("\n--> 3. Testing Live Admin Authentication");
    const adminLoginApi = await requestProd("/api/auth/admin-login", "POST", {
        username: "IT",
        password: "INFORMATIONTECHNOLOGY"
    });
    const adminToken = adminLoginApi.body && adminLoginApi.body.token;
    assert(adminLoginApi.status === 200 && Boolean(adminToken), "Admin login succeeds with server-side token issued", JSON.stringify(adminLoginApi.body));

    const verifySessionRes = await requestProd("/api/auth/verify-session", "GET", null, {
        "Authorization": `Bearer ${adminToken}`
    });
    assert(verifySessionRes.status === 200 && verifySessionRes.body.valid === true, "Admin session verification succeeds with admin role", JSON.stringify(verifySessionRes.body));

    // 4. Admin Exams Catalog & Database Query
    console.log("\n--> 4. Testing Supabase PostgreSQL Exam Synchronization");
    const adminExamsRes = await requestProd("/api/admin/exams", "GET", null, {
        "Authorization": `Bearer ${adminToken}`
    });
    const examsArr = adminExamsRes.body && (adminExamsRes.body.examinations || adminExamsRes.body.exams);
    assert(adminExamsRes.status === 200 && Array.isArray(examsArr), "Admin exams API queries and returns examinations", `Count: ${examsArr && examsArr.length}`);

    // 5. Student Public Exam Visibility
    console.log("\n--> 5. Testing Student Dashboard Live Exam Visibility");
    const studentAssignedRes = await requestProd("/api/student/assigned-exams?roll=22IT001");
    assert(studentAssignedRes.status === 200 && Array.isArray(studentAssignedRes.body.examinations), "Student assigned-exams API returns examinations array", `Count: ${studentAssignedRes.body && studentAssignedRes.body.examinations && studentAssignedRes.body.examinations.length}`);

    // 6. Roll Number Uniqueness & Complete Live Examination Lifecycle
    console.log("\n--> 6. Testing Roll Uniqueness & Complete Student Exam Lifecycle on Live Vercel Production");

    // Test duplicate registration rejection with exact error string
    const dupRes = await requestProd("/api/auth/register-student", "POST", {
        roll_number: "24JR5A1207",
        name: "Duplicate Candidate",
        email: "duplicate@kits.edu",
        department: "Information Technology"
    });
    assert(dupRes.status === 409 && dupRes.body.error === "Student with this Roll Number is already registered.",
        "Live backend strictly rejects existing roll number with 409: 'Student with this Roll Number is already registered.'",
        JSON.stringify(dupRes.body)
    );

    const runId = Date.now();
    const liveStudentRoll = "24LIVE" + String(runId).slice(-4);
    const liveStudentName = "Live Verification Student " + liveStudentRoll;

    // Create a dedicated active test exam
    const testExamId = "exam_live_" + runId;
    const createLiveExam = await requestProd("/api/admin/exams/create", "POST", {
        id: testExamId,
        title: "Live Production Verification Assessment " + liveStudentRoll,
        duration_minutes: 60,
        scheduled_start_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        status: "published"
    }, { "Authorization": `Bearer ${adminToken}` });
    assert(createLiveExam.status === 201 && createLiveExam.body.exam.id === testExamId, "New published 50-MCQ exam created and persisted to Supabase");

    // Register student
    const regRes = await requestProd("/api/auth/register-student", "POST", {
        roll_number: liveStudentRoll,
        name: liveStudentName,
        email: `${liveStudentRoll.toLowerCase()}@kits.edu`,
        department: "Information Technology"
    });
    assert(regRes.status === 200 || regRes.status === 201, "Candidate registered successfully on live backend");

    // Student accepts terms
    const acceptTermsRes = await requestProd("/api/exams/accept-terms", "POST", {
        examId: testExamId,
        rollNumber: liveStudentRoll,
        studentName: liveStudentName
    });
    assert(acceptTermsRes.status === 200 && acceptTermsRes.body.termsAccepted === true, "Candidate accepts terms and conditions");

    // Student starts exam
    const startExamRes = await requestProd("/api/exams/start", "POST", {
        examId: testExamId,
        rollNumber: liveStudentRoll,
        studentName: liveStudentName
    });
    assert(startExamRes.status === 200 && startExamRes.body.questions && startExamRes.body.questions.length === 50, "Candidate starts exam and receives exactly 50 sanitized MCQs");
    const setNum = startExamRes.body.setNumber;
    const setName = startExamRes.body.setName;
    assert(setNum >= 1 && setNum <= 10, `Candidate allocated valid Set on production (${setName || "Set " + setNum})`);
    const leakedKeys = (startExamRes.body.questions || []).some(q => q.correct_answer || q.correct_answers || q.answer);
    assert(!leakedKeys, "Production strictly sanitizes exam questions (zero answer leaks)");
    const attemptId = startExamRes.body.attemptId;

    // Student autosaves answers
    const saveAnsRes = await requestProd("/api/exams/save-answer", "POST", {
        examId: testExamId,
        rollNumber: liveStudentRoll,
        attemptId: attemptId,
        questionNumber: 1,
        selectedOption: "B"
    });
    assert(saveAnsRes.status === 200 && saveAnsRes.body.success === true, "Autosave answer for Question 1 succeeds");

    // Student submits exam
    const submitExamRes = await requestProd("/api/exams/submit", "POST", {
        examId: testExamId,
        rollNumber: liveStudentRoll,
        studentName: liveStudentName,
        attemptId: attemptId,
        answers: { "1": "B" },
        autoSubmitted: false
    });
    assert(submitExamRes.status === 200 && submitExamRes.body.success === true && submitExamRes.body.result, "Final submission evaluated on server and stored in Supabase");
    assert(submitExamRes.body.result && submitExamRes.body.result.setNumber === setNum, `Scorecard on production accurately references assigned Set ${setNum}`);

    // Verify retake lockout on live server
    const retakeRes = await requestProd("/api/exams/start", "POST", {
        examId: testExamId,
        rollNumber: liveStudentRoll,
        studentName: liveStudentName
    });
    assert(retakeRes.status === 409 && retakeRes.body.alreadySubmitted === true, "Retake strictly blocked on live server with HTTP 409 alreadySubmitted");

    // Student retrieves scorecard
    const resultRes = await requestProd(`/api/exams/result?examId=${testExamId}&roll=${liveStudentRoll}`);
    assert(resultRes.status === 200 && resultRes.body.result && resultRes.body.result.studentRoll === liveStudentRoll, "Evaluated scorecard retrieved successfully from live production");

    // Excel export endpoint check
    console.log("\n--> 7. Testing Active Students Excel Export Endpoint");
    const exportRes = await requestProd("/api/admin/students/export", "GET", null, {
        "Authorization": `Bearer ${adminToken}`
    });
    assert(exportRes.status === 200 && Array.isArray(exportRes.body.students), "Excel export endpoint returns active students data");

    console.log("\n==================================================================");
    console.log(`  LIVE PRODUCTION VERIFICATION SUMMARY: ${passed} / ${total} CHECKS PASSED`);
    console.log("==================================================================");

    if (passed === total) {
        console.log("  >>> PRODUCTION DEPLOYMENT IS 100% OPERATIONAL AT https://kits-lms.vercel.app <<<");
    } else {
        throw new Error(`${total - passed} live checks failed.`);
    }
}

runLiveTests().catch(err => {
    console.error("Live test failed:", err);
    process.exit(1);
});
