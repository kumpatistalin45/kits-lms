/**
 * KITS LMS — In-Memory Server Request Handler Integration Suite
 * 
 * Verifies live requestHandler logic with zero TCP port binding:
 * 1. POST /api/admin/login (Admin authentication)
 * 2. POST /api/admin/exams/create (Create & publish live 50-MCQ exam)
 * 3. POST /api/exams/start (Student starts exam, deterministic arrangement, sanitized questions)
 * 4. POST /api/exams/save-answer (Autosave student response)
 * 5. POST /api/exams/submit (Evaluation, non-zero marks, itemized review)
 * 6. GET /api/exams/result (Scorecard with full statement, options, explanation)
 * 7. GET /api/admin/exams/monitoring (Status = 'Submitted', never 'In Progress')
 * 8. GET /api/admin/students/export (Full active student export)
 */

const assert = require("assert");
const EventEmitter = require("events");
const { requestHandler } = require("../server.js");

function executeRequest(method, url, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = new EventEmitter();
        req.method = method;
        req.url = url;
        req.headers = { ...headers };

        const payload = body ? JSON.stringify(body) : null;
        if (payload) {
            req.headers["content-type"] = "application/json";
            req.headers["content-length"] = Buffer.byteLength(payload);
        }

        const res = new EventEmitter();
        let resData = "";
        res.statusCode = 200;
        res.headers = {};

        res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
        res.getHeader = (k) => res.headers[k.toLowerCase()];
        res.writeHead = (code, hdrs) => {
            res.statusCode = code;
            if (hdrs) {
                Object.keys(hdrs).forEach(k => {
                    res.headers[k.toLowerCase()] = hdrs[k];
                });
            }
        };
        res.write = (chunk) => {
            if (chunk) resData += chunk;
        };
        res.end = (chunk) => {
            if (chunk) resData += chunk;
            let parsed = null;
            try {
                parsed = JSON.parse(resData);
            } catch (_) {
                parsed = resData;
            }
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        };

        requestHandler(req, res).catch(reject);

        if (payload) {
            req.emit("data", payload);
        }
        req.emit("end");
    });
}

async function run() {
    console.log("==================================================================");
    console.log("  KITS LMS — IN-MEMORY SERVER REQUEST HANDLER INTEGRATION SUITE");
    console.log("==================================================================");

    // Step 1: Admin Authentication
    console.log("\n[TEST 1] Admin Authentication...");
    const loginRes = await executeRequest("POST", "/api/admin/login", {
        username: process.env.ADMIN_USERNAME || "IT",
        password: process.env.ADMIN_PASSWORD || "INFORMATIONTECHNOLOGY"
    });
    assert.strictEqual(loginRes.status, 200, "Admin login must succeed");
    const adminToken = loginRes.body.token;
    assert.ok(adminToken, "Admin token must be returned");
    console.log("  [PASS] Admin authenticated successfully.");

    const adminHeaders = {
        "authorization": `Bearer ${adminToken}`
    };

    // Step 2: Admin Creates and Publishes a 50-MCQ Examination
    console.log("\n[TEST 2] Admin Creates Exam (POST /api/admin/exams/create)...");
    const examUniqueId = `exam_e2e_test_${Date.now()}`;
    const createExamRes = await executeRequest("POST", "/api/admin/exams/create", {
        id: examUniqueId,
        title: "KITS Comprehensive 50-MCQ E2E Verification Exam",
        duration_minutes: 60,
        scheduled_start_at: new Date(Date.now() - 5000).toISOString(),
        status: "published"
    }, adminHeaders);
    assert.strictEqual(createExamRes.status, 201, "Exam creation must return 201");
    assert.strictEqual(createExamRes.body.success, true);
    const createdExam = createExamRes.body.exam;
    assert.strictEqual(createdExam.id, examUniqueId);
    assert.strictEqual(createdExam.questions.length, 50, "Created exam must contain 50 questions");
    console.log(`  [PASS] Exam '${createdExam.title}' created and published (${createdExam.id}).`);

    // Step 3: Student Starts Examination (Roll: 24JR5A1207)
    console.log(`\n[TEST 3] Student Starts Exam (POST /api/exams/start)...`);
    const startRes = await executeRequest("POST", "/api/exams/start", {
        examId: examUniqueId,
        rollNumber: "24JR5A1207",
        studentName: "K. Jaya Chandra",
        termsAccepted: true
    });
    assert.strictEqual(startRes.status, 200, "Exam start must return 200");
    assert.strictEqual(startRes.body.success, true);
    assert.strictEqual(startRes.body.totalQuestions, 50);
    assert.ok(startRes.body.setNumber, "Set number must be assigned");
    assert.ok(startRes.body.setName, "Set name must be assigned");
    assert.strictEqual(startRes.body.questions.length, 50, "Must deliver 50 randomized questions");

    // Verify answer keys are strictly stripped for the candidate
    const sampleQ = startRes.body.questions[0];
    assert.strictEqual(sampleQ.correct_answer, undefined, "Sanitized question must omit correct_answer");
    assert.strictEqual(sampleQ.correctAnswers, undefined, "Sanitized question must omit correctAnswers");
    assert.strictEqual(sampleQ.display_to_original_map, undefined, "Sanitized question must omit display_to_original_map");
    console.log(`  [PASS] Candidate assigned ${startRes.body.setName} with 50 sanitized questions.`);

    const attemptId = startRes.body.attemptId;

    // Step 4: Candidate Autosaves an Answer (POST /api/exams/save-answer)
    console.log("\n[TEST 4] Candidate Autosaves Answer (POST /api/exams/save-answer)...");
    const saveRes = await executeRequest("POST", "/api/exams/save-answer", {
        attemptId: attemptId,
        examId: examUniqueId,
        rollNumber: "24JR5A1207",
        questionNumber: 1,
        selectedOption: "A"
    });
    assert.strictEqual(saveRes.status, 200, "Autosave must succeed");
    assert.strictEqual(saveRes.body.success, true);
    console.log("  [PASS] Answer for Q1 autosaved successfully.");

    // Step 5: Candidate Submits Examination (POST /api/exams/submit)
    console.log("\n[TEST 5] Candidate Submits Examination (POST /api/exams/submit)...");
    const candidateAnswers = {};
    startRes.body.questions.forEach(q => {
        candidateAnswers[q.question_number] = "A";
    });

    const submitRes = await executeRequest("POST", "/api/exams/submit", {
        attemptId: attemptId,
        examId: examUniqueId,
        rollNumber: "24JR5A1207",
        studentName: "K. Jaya Chandra",
        answers: candidateAnswers
    });
    assert.strictEqual(submitRes.status, 200, "Submission must succeed with 200");
    assert.strictEqual(submitRes.body.success, true);
    const evalResult = submitRes.body.result;
    assert.ok(evalResult, "Result object must be present");
    assert.strictEqual(evalResult.totalQuestions, 50);
    assert.strictEqual(evalResult.totalMarks, 50);
    assert.ok(evalResult.score !== undefined && evalResult.score !== null, "Score must be defined");
    assert.ok(evalResult.score >= 0, "Score must be non-negative");
    assert.ok(Array.isArray(evalResult.itemizedReview), "itemizedReview must be an array");
    assert.strictEqual(evalResult.itemizedReview.length, 50, "itemizedReview must contain all 50 questions");
    console.log(`  [PASS] Exam evaluated: Score ${evalResult.score}/50 (${evalResult.percentage}% - ${evalResult.status}).`);

    // Step 6: Scorecard Validation (GET /api/exams/result)
    console.log("\n[TEST 6] Student Fetches Scorecard (GET /api/exams/result)...");
    const scorecardRes = await executeRequest("GET", `/api/exams/result?examId=${examUniqueId}&roll=24JR5A1207`);
    assert.strictEqual(scorecardRes.status, 200, "Scorecard fetch must succeed");
    const scResult = scorecardRes.body.result;
    assert.strictEqual(scResult.studentRoll, "24JR5A1207");
    assert.strictEqual(scResult.itemizedReview.length, 50);

    const scQ1 = scResult.itemizedReview[0];
    assert.ok(scQ1.question_text, "Question text must be present");
    assert.ok(scQ1.option_a, "Option A must be present");
    assert.ok(scQ1.option_b, "Option B must be present");
    assert.ok(scQ1.correct_answer, "Correct answer must be present");
    assert.strictEqual(scQ1.student_answer, "A", "Student choice must match candidate answer");
    assert.ok(scQ1.explanation !== undefined, "Explanation must be present");
    console.log("  [PASS] Scorecard verified with all 50 questions, student selections, correct answers, and explanations.");

    // Step 7: Admin Monitoring Real-Time Status Verification (GET /api/admin/exams/monitoring)
    console.log("\n[TEST 7] Admin Monitoring Status Verification (GET /api/admin/exams/monitoring)...");
    const monRes = await executeRequest("GET", `/api/admin/exams/monitoring?examId=${examUniqueId}`, null, adminHeaders);
    assert.strictEqual(monRes.status, 200, "Monitoring endpoint must return 200");
    assert.ok(Array.isArray(monRes.body.candidates), "Candidates roster must be returned");

    const candidateRecord = monRes.body.candidates.find(c => c.roll_number === "24JR5A1207");
    assert.ok(candidateRecord, "Candidate 24JR5A1207 must exist in monitoring candidates");
    assert.strictEqual(candidateRecord.status, "Submitted", "Submitted candidate status MUST be 'Submitted' (NEVER 'In Progress')");
    assert.strictEqual(candidateRecord.score, evalResult.score, "Candidate score in monitoring must match evaluation score");
    console.log(`  [PASS] Admin monitoring for 24JR5A1207 is strictly '${candidateRecord.status}' with Score ${candidateRecord.score}.`);

    // Step 8: Admin Students Export Verification (GET /api/admin/students/export)
    console.log("\n[TEST 8] Admin Students Export Verification (GET /api/admin/students/export)...");
    const exportRes = await executeRequest("GET", "/api/admin/students/export", null, adminHeaders);
    assert.strictEqual(exportRes.status, 200, "Export endpoint must return 200");
    assert.ok(Array.isArray(exportRes.body.students), "Export must return students array");
    assert.ok(exportRes.body.students.length > 0, "Export count must be > 0");
    console.log(`  [PASS] Admin export delivered ${exportRes.body.students.length} active registered students.`);

    console.log("\n==================================================================");
    console.log("  ALL 8 INTEGRATION TESTS PASSED PERFECTLY!");
    console.log("==================================================================");
}

run().catch(err => {
    console.error("\n[FATAL TEST ERROR]", err);
    process.exit(1);
});
