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

    // 12. Manual Question Management & Dynamic Configuration Live Verification
    console.log("\n[VERIFY 13] Verifying Live Admin Dashboard HTML for Manual Question Management Elements...");
    const adminHtmlRes = await requestLive("GET", "/admin-dashboard");
    assert.strictEqual(adminHtmlRes.status, 200, "/admin-dashboard must be served");
    assert(adminHtmlRes.body.includes("modalAddQuestionBtn"), "modalAddQuestionBtn must be present in admin-dashboard.html");
    assert(adminHtmlRes.body.includes("addNewQuestionInReviewBtn"), "addNewQuestionInReviewBtn must be present in admin-dashboard.html");
    assert(adminHtmlRes.body.includes("examFormDuration"), "examFormDuration must be present in admin-dashboard.html");
    console.log("  [PASS] Admin Dashboard HTML confirmed with Add Question buttons & editable timer.");

    // 13. Create Live Custom Exam with Dynamic Questions & Marks
    const customExamId = `exam_manual_live_${Date.now()}`;
    console.log(`\n[VERIFY 14] Creating Custom Live Exam with Dynamic Questions, Marks & Timer (${customExamId})...`);
    const customQuestions = [
        {
            id: "q_custom_1",
            question_number: 1,
            question_text: "What is the time complexity of QuickSort average case?",
            statement: "What is the time complexity of QuickSort average case?",
            option_a: "O(n)",
            option_b: "O(n log n)",
            option_c: "O(n^2)",
            option_d: "O(log n)",
            type: "mcq",
            correct_answer: "B",
            marks: 3,
            explanation: "Average-case time complexity of QuickSort is O(n log n)."
        },
        {
            id: "q_custom_2",
            question_number: 2,
            question_text: "Which of the following are ACID properties in DBMS? (Select all)",
            statement: "Which of the following are ACID properties in DBMS? (Select all)",
            option_a: "Atomicity",
            option_b: "Consistency",
            option_c: "Isolation",
            option_d: "Durability",
            type: "msq",
            correct_answers: ["A", "B", "C", "D"],
            correct_answer: "A,B,C,D",
            marks: 4,
            explanation: "ACID stands for Atomicity, Consistency, Isolation, and Durability."
        },
        {
            id: "q_custom_3",
            question_number: 3,
            question_text: "Which protocol is used for secure communications over the Internet?",
            statement: "Which protocol is used for secure communications over the Internet?",
            option_a: "HTTP",
            option_b: "HTTPS",
            option_c: "FTP",
            option_d: "TELNET",
            type: "mcq",
            correct_answer: "B",
            marks: 3,
            explanation: "HTTPS encrypts communications using TLS/SSL."
        }
    ];

    const createCustomRes = await requestLive("POST", "/api/admin/exams/create", {
        id: customExamId,
        title: "Live Production Dynamic Assessment (3 Questions • 10 Marks)",
        duration_minutes: 40,
        scheduled_start_at: new Date(Date.now() - 10000).toISOString(),
        status: "published",
        questions: customQuestions
    }, adminHeaders);

    assert.strictEqual(createCustomRes.status, 201, "Custom exam creation must return 201");
    assert.strictEqual(createCustomRes.body.exam.total_questions, 3, "Total questions must be 3");
    assert.strictEqual(createCustomRes.body.exam.total_marks, 10, "Total marks must be 3+4+3 = 10");
    assert.strictEqual(createCustomRes.body.exam.duration_minutes, 40, "Duration must be 40 mins");
    console.log(`  [PASS] Custom live exam created with 3 questions, 10 total marks, and 40 min timer.`);

    // 14. Edit Live Custom Exam (Change Statement & Duration)
    console.log("\n[VERIFY 15] Editing Live Custom Exam Questions & Duration...");
    const editedQuestions = JSON.parse(JSON.stringify(customQuestions));
    editedQuestions[0].question_text = "What is the expected average-case time complexity of QuickSort?";
    editedQuestions[0].statement = editedQuestions[0].question_text;
    editedQuestions[0].marks = 5; // Change marks from 3 to 5

    const editRes = await requestLive("POST", "/api/admin/exams/save", {
        id: customExamId,
        duration_minutes: 45,
        questions: editedQuestions
    }, adminHeaders);

    assert.strictEqual(editRes.status, 200, "Edit exam must return 200");
    assert.strictEqual(editRes.body.exam.duration_minutes, 45, "Duration must be updated to 45 mins");
    assert.strictEqual(editRes.body.exam.total_marks, 12, "Total marks must be updated to 5+4+3 = 12");
    console.log(`  [PASS] Live exam edited: Duration 45m, Total Marks 12.`);

    // 15. Student Starts Live Custom Exam
    console.log("\n[VERIFY 16] Candidate Starts Custom Live Exam...");
    const startCustomRes = await requestLive("POST", "/api/exams/start", {
        examId: customExamId,
        rollNumber: "22IT001",
        studentName: "A. Srikanth",
        termsAccepted: true
    });

    assert.strictEqual(startCustomRes.status, 200, "Start custom exam must return 200");
    assert.strictEqual(startCustomRes.body.totalQuestions, 3, "Candidate receives exactly 3 questions");
    assert.strictEqual(startCustomRes.body.totalMarks, 12, "Candidate receives totalMarks = 12");
    assert.strictEqual(startCustomRes.body.durationMinutes, 45, "Candidate receives durationMinutes = 45");
    console.log(`  [PASS] Candidate started custom exam with 3 sanitized questions and 45 min timer.`);

    // 16. Attempted Exam Protection Live Check
    console.log("\n[VERIFY 17] Attempted Exam Deletion Protection Live Check...");
    const illegalEditRes = await requestLive("POST", "/api/admin/exams/save", {
        id: customExamId,
        questions: editedQuestions.slice(0, 1) // Attempting to drop questions from attempted exam
    }, adminHeaders);

    assert.strictEqual(illegalEditRes.status, 400, "Server must reject modifying question count on attempted exam (HTTP 400)");
    console.log(`  [PASS] Deletion of questions on attempted exam successfully rejected with HTTP 400.`);

    // 17. Submit Custom Exam & Verify Dynamic Evaluation
    console.log("\n[VERIFY 18] Submitting Custom Exam & Verifying Dynamic Scoring...");
    const { generateStudentExamArrangement } = require("../exam-randomizer.js");
    const customArr = generateStudentExamArrangement(editRes.body.exam, "22IT001");
    const customAnswers = {};
    customArr.questions.forEach(q => {
        if (q.type === "msq") {
            customAnswers[q.display_number] = q.displayed_correct_answers;
        } else {
            customAnswers[q.display_number] = q.displayed_correct_answer;
        }
    });

    const submitCustomRes = await requestLive("POST", "/api/exams/submit", {
        attemptId: startCustomRes.body.attemptId,
        examId: customExamId,
        rollNumber: "22IT001",
        studentName: "A. Srikanth",
        answers: customAnswers
    });

    assert.strictEqual(submitCustomRes.status, 200, "Submit custom exam must return 200");
    const customEval = submitCustomRes.body.result;
    assert.strictEqual(customEval.score, 12, "Score must match total configured marks (12/12)");
    assert.strictEqual(customEval.totalMarks, 12, "Total marks must be 12");
    assert.strictEqual(customEval.percentage, 100, "Percentage must be 100%");
    assert.strictEqual(customEval.status, "Pass", "Status must be Pass");
    console.log(`  [PASS] Candidate scored ${customEval.score}/${customEval.totalMarks} (${customEval.percentage}%) using configured question marks.`);

    console.log("\n==================================================================");
    console.log("  >>> ALL LIVE PRODUCTION VERIFICATIONS PASSED 100% <<<");
    console.log("==================================================================");
}

verifyProduction().catch(err => {
    console.error("\n[LIVE VERIFICATION FAILED]", err);
    process.exit(1);
});

