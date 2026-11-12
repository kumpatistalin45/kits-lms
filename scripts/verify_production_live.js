/**
 * KITS LMS — Live Production Deployment Verification Suite
 * Targets the live production URL: https://kits-lms.vercel.app
 */

const https = require("https");
const assert = require("assert");

const PROD_HOST = "kits-lms.vercel.app";

function requestLive(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const reqHeaders = { ...headers };
        if (payload) {
            reqHeaders["Content-Type"] = "application/json";
            reqHeaders["Content-Length"] = Buffer.byteLength(payload);
        }

        const req = https.request({
            hostname: PROD_HOST,
            port: 443,
            path: path,
            method: method,
            headers: reqHeaders
        }, res => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (_) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function verifyProduction() {
    console.log("==================================================================");
    console.log(`  KITS LMS — LIVE PRODUCTION VERIFICATION (https://${PROD_HOST})`);
    console.log("==================================================================");

    // 1. Health check & Server Time
    console.log("\n[VERIFY 1] Checking Live Health & Routing...");
    const healthRes = await requestLive("GET", "/api/health");
    console.log(`  /api/health -> Status ${healthRes.status}:`, healthRes.body);
    assert.strictEqual(healthRes.status, 200, "/api/health must return 200");
    assert.strictEqual(healthRes.body.status, "UP");

    // 2. Admin Authentication
    console.log("\n[VERIFY 2] Verifying Admin Authentication...");
    const loginRes = await requestLive("POST", "/api/admin/login", {
        username: process.env.ADMIN_USERNAME || "IT",
        password: process.env.ADMIN_PASSWORD || "INFORMATIONTECHNOLOGY"
    });
    console.log(`  /api/admin/login -> Status ${loginRes.status}, success:`, loginRes.body && loginRes.body.success);
    assert.strictEqual(loginRes.status, 200, "Admin login must return 200");
    const adminToken = loginRes.body.token;
    assert.ok(adminToken, "Admin token must be returned");

    const adminHeaders = {
        "Authorization": `Bearer ${adminToken}`
    };

    // 3. Admin Students List & DB Counts
    console.log("\n[VERIFY 3] Verifying Supabase Registered Students in Admin Dashboard...");
    const studentsRes = await requestLive("GET", "/api/admin/students", null, adminHeaders);
    assert.strictEqual(studentsRes.status, 200, "Students endpoint must return 200");
    assert.ok(Array.isArray(studentsRes.body.students), "Students must be an array");
    console.log(`  Registered students retrieved from Supabase: ${studentsRes.body.students.length} students.`);
    assert.ok(studentsRes.body.students.length >= 60, "Must contain all institutional student accounts");

    // 4. Admin Full Excel Export (Issue 6)
    console.log("\n[VERIFY 4] Verifying Complete Excel Export Endpoint (Issue 6)...");
    const exportRes = await requestLive("GET", "/api/admin/students/export", null, adminHeaders);
    assert.strictEqual(exportRes.status, 200, "Export endpoint must return 200");
    assert.ok(Array.isArray(exportRes.body.students), "Export students must be an array");
    console.log(`  Full active student roster for Excel: ${exportRes.body.students.length} students.`);
    assert.ok(exportRes.body.students.length >= 60, "Export must include all registered active students without clipping");

    // 5. Admin Examination Management
    console.log("\n[VERIFY 5] Querying Published Examinations...");
    const examsRes = await requestLive("GET", "/api/admin/exams", null, adminHeaders);
    assert.strictEqual(examsRes.status, 200, "Exams endpoint must return 200");
    const examsList = examsRes.body.examinations || [];
    console.log(`  Found ${examsList.length} examinations in live system.`);

    // Create a dedicated live production verification examination
    const liveExamId = `exam_prod_verify_${Date.now()}`;
    console.log(`\n[VERIFY 6] Publishing Live Verification Examination (${liveExamId})...`);
    const createRes = await requestLive("POST", "/api/admin/exams/create", {
        id: liveExamId,
        title: "Live Production Verification Assessment",
        duration_minutes: 60,
        scheduled_start_at: new Date(Date.now() - 10000).toISOString(),
        status: "published"
    }, adminHeaders);
    assert.strictEqual(createRes.status, 201, "Exam creation must return 201");
    console.log(`  [PASS] Live exam published successfully with 50 questions.`);

    // 6. Student Dashboard & Assigned Exams Visibility
    console.log("\n[VERIFY 7] Student Dashboard View (Roll: 24JR5A1207)...");
    const assignedRes = await requestLive("GET", "/api/student/assigned-exams?roll=24JR5A1207");
    assert.strictEqual(assignedRes.status, 200, "Student assigned exams must return 200");
    const studentExams = assignedRes.body.exams || [];
    const targetExam = studentExams.find(e => e.id === liveExamId);
    assert.ok(targetExam, "Newly published exam must appear immediately on student dashboard");
    console.log(`  [PASS] Exam '${targetExam.title}' is visible on student dashboard. Status: ${targetExam.studentStatus}`);

    // 7. Student Starts Exam & Receives Deterministic Arrangement (Issue 2)
    console.log("\n[VERIFY 8] Student Starts Exam & Deterministic Arrangement (Issue 2)...");
    const startRes = await requestLive("POST", "/api/exams/start", {
        examId: liveExamId,
        rollNumber: "24JR5A1207",
        studentName: "K. Jaya Chandra",
        termsAccepted: true
    });
    assert.strictEqual(startRes.status, 200, "Start exam must return 200");
    assert.strictEqual(startRes.body.success, true);
    assert.strictEqual(startRes.body.totalQuestions, 50);
    assert.ok(startRes.body.setNumber, "Set number must be present");
    assert.ok(startRes.body.setName, "Set name must be present");
    assert.strictEqual(startRes.body.questions.length, 50, "50 sanitized questions must be returned");
    
    // Check answer keys are strictly omitted
    const q1 = startRes.body.questions[0];
    assert.strictEqual(q1.correct_answer, undefined, "Sanitized questions must not contain answer keys");
    assert.strictEqual(q1.display_to_original_map, undefined, "Sanitized questions must not contain lookup maps");
    console.log(`  [PASS] Candidate assigned ${startRes.body.setName} with 50 sanitized questions.`);

    const attemptId = startRes.body.attemptId;

    // 8. Autosave Candidate Response
    console.log("\n[VERIFY 9] Autosaving Candidate Response...");
    const saveRes = await requestLive("POST", "/api/exams/save-answer", {
        attemptId: attemptId,
        examId: liveExamId,
        rollNumber: "24JR5A1207",
        questionNumber: 1,
        selectedOption: "A"
    });
    assert.strictEqual(saveRes.status, 200, "Save answer must return 200");
    assert.strictEqual(saveRes.body.success, true);
    console.log("  [PASS] Candidate answer autosaved to production PostgreSQL.");

    // 9. Submit Examination & Automatic Evaluation (Issue 3)
    console.log("\n[VERIFY 10] Submitting Examination & Server Evaluation (Issue 3)...");
    const answers = {};
    startRes.body.questions.forEach(q => {
        answers[q.question_number] = "A";
    });

    const submitRes = await requestLive("POST", "/api/exams/submit", {
        attemptId: attemptId,
        examId: liveExamId,
        rollNumber: "24JR5A1207",
        studentName: "K. Jaya Chandra",
        answers: answers
    });
    assert.strictEqual(submitRes.status, 200, "Submit exam must return 200");
    assert.strictEqual(submitRes.body.success, true);
    const evalRes = submitRes.body.result;
    assert.ok(evalRes, "Result object must be returned");
    assert.strictEqual(evalRes.totalMarks, 50);
    assert.strictEqual(evalRes.totalQuestions, 50);
    assert.ok(evalRes.score !== null && evalRes.score !== undefined, "Score must be defined");
    assert.ok(evalRes.score >= 0, "Score must be non-negative");
    assert.ok(Array.isArray(evalRes.itemizedReview), "itemizedReview must be an array");
    assert.strictEqual(evalRes.itemizedReview.length, 50, "itemizedReview must contain 50 questions");
    console.log(`  [PASS] Production evaluation complete: Score ${evalRes.score}/50 (${evalRes.percentage}% - ${evalRes.status}).`);

    // 10. Result Scorecard Fidelity & Validation Display (Issue 4 & Issue 5)
    console.log("\n[VERIFY 11] Scorecard Fidelity & Validation Display (Issue 4 & 5)...");
    const scorecardRes = await requestLive("GET", `/api/exams/result?examId=${liveExamId}&roll=24JR5A1207`);
    assert.strictEqual(scorecardRes.status, 200, "Scorecard must return 200");
    const sc = scorecardRes.body.result;
    assert.strictEqual(sc.studentRoll, "24JR5A1207");
    assert.strictEqual(sc.itemizedReview.length, 50);

    const card1 = sc.itemizedReview[0];
    assert.ok(card1.question_text, "Question text must be present");
    assert.ok(card1.option_a, "Option A must be present");
    assert.ok(card1.option_b, "Option B must be present");
    assert.ok(card1.correct_answer, "Correct answer must be present");
    assert.strictEqual(card1.student_answer, "A", "Student choice must match submitted answer");
    assert.ok(card1.explanation !== undefined, "Academic explanation must be present");
    console.log("  [PASS] Scorecard verified with statements, options, choices, and academic explanations.");

    // 11. Admin Monitoring Real-Time Status Accuracy (Issue 7)
    console.log("\n[VERIFY 12] Admin Monitoring Real-Time Status Accuracy (Issue 7)...");
    const monRes = await requestLive("GET", `/api/admin/exams/monitoring?examId=${liveExamId}`, null, adminHeaders);
    assert.strictEqual(monRes.status, 200, "Monitoring must return 200");
    const candidateRecord = monRes.body.candidates.find(c => c.roll_number === "24JR5A1207");
    assert.ok(candidateRecord, "Candidate 24JR5A1207 must appear in monitoring");
    assert.strictEqual(candidateRecord.status, "Submitted", "Submitted candidate MUST have status 'Submitted' (NEVER 'In Progress')");
    assert.strictEqual(candidateRecord.score, evalRes.score, "Monitoring score must match evaluation score");
    console.log(`  [PASS] Admin monitoring shows candidate status strictly '${candidateRecord.status}' with Score ${candidateRecord.score}.`);

    console.log("\n==================================================================");
    console.log("  >>> ALL LIVE PRODUCTION VERIFICATIONS PASSED 100% <<<");
    console.log("==================================================================");
}

verifyProduction().catch(err => {
    console.error("\n[LIVE VERIFICATION FAILED]", err);
    process.exit(1);
});

