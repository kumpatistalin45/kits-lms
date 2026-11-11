/**
 * KITS LMS — Complete End-to-End Online Examination Platform Verification
 * Tests All Functional & Security Requirements:
 * 1. Admin Authentication with IT / INFORMATIONTECHNOLOGY
 * 2. Authoritative IST Server Time (/api/server-time)
 * 3. Safe Legacy Course Cleanup (with confirmation phrase)
 * 4. 50-MCQ Exam Creation & IST Scheduling (/api/admin/exams/create)
 * 5. Safe Exam Deletion (with confirmation phrase)
 * 6. Student Assigned Exams & Sanitized Question Bank (/api/student/assigned-exams)
 * 7. Single Attempt Enforcement & Late Start Calculation (/api/exams/start)
 * 8. Real-time Answer Autosaving (/api/exams/save-answer)
 * 9. Server-Side 50-MCQ Evaluation & Scoring (/api/exams/submit)
 * 10. Re-attempt Lockout Verification (Strictly No Retakes)
 * 11. Individual Scorecard & Itemized Review (/api/exams/result)
 * 12. Candidate Isolated Exam Monitoring (/api/admin/exams/monitoring)
 */

const http = require("http");

const BASE_URL = "http://127.0.0.1:3000";

function request(options, body = null) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(options.url || (BASE_URL + options.path));
        const reqOpts = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || "GET",
            headers: options.headers || {}
        };

        if (body && !reqOpts.headers["Content-Type"]) {
            reqOpts.headers["Content-Type"] = "application/json";
        }

        const req = http.request(reqOpts, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
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

function assert(condition, message) {
    if (!condition) {
        console.error(`❌ ASSERTION FAILED: ${message}`);
        throw new Error(message);
    }
    console.log(`  ✓ ${message}`);
}

async function runTests() {
    console.log("\n========================================================");
    console.log("🚀 KITS LMS — ONLINE EXAMINATION PLATFORM E2E VERIFICATION");
    console.log("========================================================\n");

    let adminToken = null;
    let testExamId = null;

    // STEP 1: Authoritative Server Time
    console.log("[TEST 1] Verifying Authoritative Server Clock & IST Timezone...");
    const timeRes = await request({ path: "/api/server-time" });
    assert(timeRes.status === 200, "Server time endpoint returns HTTP 200");
    assert(timeRes.body.timezone && timeRes.body.timezone.includes("Asia/Kolkata"), "Timezone is Asia/Kolkata (IST)");
    assert(typeof (timeRes.body.timestamp || timeRes.body.serverTimestamp) === "number", "Server timestamp is authoritative integer");
    console.log(`    Current Server IST: ${timeRes.body.ist || timeRes.body.istFormatted}`);

    // STEP 2: Admin Login
    console.log("\n[TEST 2] Verifying Admin Authentication (IT / INFORMATIONTECHNOLOGY)...");
    const loginRes = await request({
        path: "/api/auth/admin-login",
        method: "POST"
    }, {
        username: "IT",
        password: "INFORMATIONTECHNOLOGY"
    });
    assert(loginRes.status === 200, "Admin login succeeds with HTTP 200");
    assert(loginRes.body.success === true, "Admin login returns success: true");
    assert(loginRes.body.token, "Admin receives valid session token");
    adminToken = loginRes.body.token;

    const authHeaders = { "Authorization": `Bearer ${adminToken}` };

    // STEP 3: Legacy Course Cleanup Protection
    console.log("\n[TEST 3] Verifying Legacy Course Cleanup Safe Deletion...");
    const badCleanupRes = await request({
        path: "/api/admin/legacy/cleanup",
        method: "POST",
        headers: authHeaders
    }, {
        confirmationPhrase: "WRONG PHRASE"
    });
    assert(badCleanupRes.status === 400, "Cleanup rejects incorrect confirmation phrase with HTTP 400");

    const goodCleanupRes = await request({
        path: "/api/admin/legacy/cleanup",
        method: "POST",
        headers: authHeaders
    }, {
        confirmationPhrase: "DELETE LEGACY COURSES"
    });
    assert(goodCleanupRes.status === 200, "Cleanup succeeds with exact phrase 'DELETE LEGACY COURSES'");
    assert(goodCleanupRes.body.success === true, "Legacy courses successfully purged");

    // STEP 4: Admin Exam Management — Listing & Creation
    console.log("\n[TEST 4] Verifying 50-MCQ Exam Creation & IST Scheduling...");
    const listExamsRes = await request({
        path: "/api/admin/exams",
        headers: authHeaders
    });
    assert(listExamsRes.status === 200, "GET /api/admin/exams returns HTTP 200");
    assert(Array.isArray(listExamsRes.body.examinations), "Examinations list returned");
    console.log(`    Existing examinations count: ${listExamsRes.body.examinations.length}`);

    // Create a new 50-MCQ Exam scheduled now (in IST)
    const now = new Date();
    const scheduledStart = now.toISOString();

    const sample50Questions = [];
    for (let i = 1; i <= 50; i++) {
        sample50Questions.push({
            question_number: i,
            question_text: `Test Question ${i}: What is the output of standard evaluation #${i}?`,
            option_a: `Option A for Q${i}`,
            option_b: `Option B for Q${i}`,
            option_c: `Option C for Q${i}`,
            option_d: `Option D for Q${i}`,
            correct_answer: (i % 2 === 0) ? "B" : "A", // Half A, Half B
            explanation: `Explanation for Q${i}: Option ${(i % 2 === 0) ? "B" : "A"} is logically correct.`
        });
    }

    const createExamRes = await request({
        path: "/api/admin/exams/create",
        method: "POST",
        headers: authHeaders
    }, {
        title: "E2E Verification Mid-Term Exam (50 MCQs)",
        description: "Official Automated Assessment 50 MCQs • 50 Marks • 60 Mins",
        scheduledStartAt: scheduledStart,
        cohorts: ["All Students"],
        questions: sample50Questions
    });

    assert(createExamRes.status === 200 || createExamRes.status === 201, "Exam creation succeeds with HTTP 200/201");
    assert(createExamRes.body.success === true, "Exam created successfully");
    assert(createExamRes.body.exam.questions.length === 50, "Exam contains exactly 50 MCQs");
    assert(createExamRes.body.exam.total_marks === 50, "Exam configured for exactly 50 Marks");
    assert(createExamRes.body.exam.duration_minutes === 60, "Exam configured for exactly 60 Minutes");
    testExamId = createExamRes.body.exam.id;
    console.log(`    Created Exam ID: ${testExamId}`);

    // STEP 5: Safe Exam Deletion Verification (Create dummy exam to test safe deletion)
    console.log("\n[TEST 5] Verifying Safe Exam Deletion with Typed Confirmation Phrase...");
    const dummyExamRes = await request({
        path: "/api/admin/exams/create",
        method: "POST",
        headers: authHeaders
    }, {
        title: "Temporary Deletion Test Exam",
        description: "To be safely deleted",
        scheduledStartAt: scheduledStart,
        cohorts: ["All Students"],
        questions: sample50Questions
    });
    assert(dummyExamRes.status === 200 || dummyExamRes.status === 201, "Dummy exam creation succeeds");
    const dummyId = dummyExamRes.body.exam.id;

    const badDeleteRes = await request({
        path: "/api/admin/exams/delete",
        method: "POST",
        headers: authHeaders
    }, {
        examId: dummyId,
        confirmationPhrase: "SOME WRONG PHRASE"
    });
    assert(badDeleteRes.status === 400, "Safe delete rejects non-matching phrase with HTTP 400");

    const goodDeleteRes = await request({
        path: "/api/admin/exams/delete",
        method: "POST",
        headers: authHeaders
    }, {
        examId: dummyId,
        confirmationPhrase: "CONFIRM DELETE"
    });
    assert(goodDeleteRes.status === 200, "Safe delete accepts 'CONFIRM DELETE'");
    assert(goodDeleteRes.body.success === true, "Exam safely purged with all cascading records");

    // STEP 6: Student Assigned Exams & Question Bank Sanitization
    console.log("\n[TEST 6] Verifying Student Assigned Exams & Question Sanitization...");
    const studentRoll = "22IT001";
    const assignedRes = await request({
        path: `/api/student/assigned-exams?roll=${studentRoll}`
    });
    assert(assignedRes.status === 200, "GET /api/student/assigned-exams returns HTTP 200");
    const examsList = assignedRes.body.assignedExams || assignedRes.body.examinations;
    assert(Array.isArray(examsList), "Assigned exams returned");
    const targetAssigned = examsList.find(e => e.id === testExamId);
    assert(targetAssigned !== undefined, "Candidate 22IT001 has target exam assigned");
    assert(targetAssigned.total_questions === 50, "Exam displays 50 total questions");

    // STEP 7: Exam Start & Single Attempt Rule
    console.log("\n[TEST 7] Verifying Exam Start & Single Attempt Enforcement...");
    const startRes = await request({
        path: "/api/exams/start",
        method: "POST"
    }, {
        examId: testExamId,
        rollNumber: studentRoll,
        studentName: "John Doe"
    });
    assert(startRes.status === 200, "POST /api/exams/start returns HTTP 200");
    assert(startRes.body.success === true, "Attempt initialized successfully");
    assert(startRes.body.attemptId, "Candidate assigned unique attemptId");
    assert(startRes.body.questions.length === 50, "Sanitized question bank contains 50 questions");

    // Check that answers are NEVER leaked to student
    const hasLeakedKey = startRes.body.questions.some(q => q.correct_answer || q.explanation || q.answer);
    assert(!hasLeakedKey, "SECURITY: Correct answer keys & explanations are completely stripped from student view");
    assert(startRes.body.remainingSeconds <= 3600, "Remaining seconds respects 60-minute window");
    const attemptId = startRes.body.attemptId;

    // Test resuming attempt without duplicate creation
    const resumeRes = await request({
        path: "/api/exams/start",
        method: "POST"
    }, {
        examId: testExamId,
        rollNumber: studentRoll,
        studentName: "John Doe"
    });
    assert(resumeRes.status === 200, "Re-calling start resumes attempt");
    assert(resumeRes.body.attemptId === attemptId, "Attempt ID matches initial attempt (No duplicate created)");

    // STEP 8: Autosaving Responses
    console.log("\n[TEST 8] Verifying Real-Time Candidate Answer Autosaving...");
    const candidateAnswers = {};
    for (let q = 1; q <= 50; q++) {
        // Let's answer 40 correctly and 10 incorrectly (40/50 = 80% Pass)
        let choice = (q % 2 === 0) ? "B" : "A";
        if (q > 40) {
            choice = "C"; // Intentionally wrong
        }
        candidateAnswers[q] = choice;

        if (q <= 5) {
            // Test autosave API for first 5 questions
            const autoRes = await request({
                path: "/api/exams/save-answer",
                method: "POST"
            }, {
                attemptId: attemptId,
                examId: testExamId,
                rollNumber: studentRoll,
                questionNumber: q,
                selectedOption: choice
            });
            assert(autoRes.status === 200, `Autosave for Q${q} succeeds`);
        }
    }

    // STEP 9: Final Submission & Server-Side 50-MCQ Evaluation
    console.log("\n[TEST 9] Verifying Final Submission & Server-Side 50-MCQ Evaluation...");
    const submitRes = await request({
        path: "/api/exams/submit",
        method: "POST"
    }, {
        examId: testExamId,
        rollNumber: studentRoll,
        studentName: "John Doe",
        attemptId: attemptId,
        answers: candidateAnswers,
        autoSubmitted: false
    });

    assert(submitRes.status === 200, "Submit returns HTTP 200");
    assert(submitRes.body.success === true, "Submit returns success: true");
    const result = submitRes.body.result;
    assert(result.score === 40, `Evaluation awarded exactly 40/50 marks (Actual: ${result.score})`);
    assert(result.totalMarks === 50, "Total marks is 50");
    assert(result.percentage === 80, `Percentage is 80% (Actual: ${result.percentage}%)`);
    assert(result.status === "Pass", `Status is Pass (Actual: ${result.status})`);
    assert(result.correctCount === 40, "Correct count is 40");
    assert(result.wrongCount === 10, "Wrong count is 10");
    assert(result.itemizedReview.length === 50, "Itemized review generated for all 50 questions");
    console.log(`    Candidate Score: ${result.score}/50 (${result.percentage}% - ${result.status})`);

    // STEP 10: Strict Re-Attempt Lockout
    console.log("\n[TEST 10] Verifying Strict Re-attempt Lockout (One Attempt Only)...");
    const reStartRes = await request({
        path: "/api/exams/start",
        method: "POST"
    }, {
        examId: testExamId,
        rollNumber: studentRoll,
        studentName: "John Doe"
    });
    assert(reStartRes.body.alreadySubmitted === true, "Server strictly rejects re-attempt with alreadySubmitted: true");

    // Idempotent submit test
    const reSubmitRes = await request({
        path: "/api/exams/submit",
        method: "POST"
    }, {
        examId: testExamId,
        rollNumber: studentRoll,
        attemptId: attemptId,
        answers: candidateAnswers
    });
    assert(reSubmitRes.body.duplicatePrevented === true, "Idempotency guard prevents duplicate scorecard creation");

    // STEP 11: Individual Scorecard & Review
    console.log("\n[TEST 11] Verifying Individual Scorecard Retrieval...");
    const scorecardRes = await request({
        path: `/api/exams/result?examId=${testExamId}&roll=${studentRoll}`
    });
    assert(scorecardRes.status === 200, "Scorecard endpoint returns HTTP 200");
    assert(scorecardRes.body.result.studentRoll === studentRoll, "Scorecard belongs to candidate 22IT001");
    assert(scorecardRes.body.result.itemizedReview[0].correct_answer !== undefined, "Itemized review contains correct answer after submission");

    // STEP 12: Admin Candidate-Isolated Monitoring
    console.log("\n[TEST 12] Verifying Admin Dedicated Exam Monitoring & Candidate Isolation...");
    const monitorRes = await request({
        path: `/api/admin/exams/monitoring?examId=${testExamId}`,
        headers: authHeaders
    });
    assert(monitorRes.status === 200, "Exam monitoring endpoint returns HTTP 200");
    assert(monitorRes.body.exam.id === testExamId, "Monitoring targets exact selected exam");
    const candidates = monitorRes.body.candidates;
    const testCandidate = candidates.find(c => c.rollNumber === studentRoll);
    assert(testCandidate !== undefined, "Candidate 22IT001 found in exam monitoring cohort");
    assert(testCandidate.status === "Submitted", `Candidate status correctly recorded as 'Submitted' (Actual: ${testCandidate.status})`);
    assert(testCandidate.marksObtained === 40, `Candidate marks accurately recorded as 40/50`);
    console.log(`    Monitoring Summary: Total Candidates: ${monitorRes.body.counts ? monitorRes.body.counts.totalAssigned : candidates.length}, Submitted: ${monitorRes.body.counts ? monitorRes.body.counts.submitted : 1}`);

    console.log("\n========================================================");
    console.log("🎉 ALL 12 END-TO-END VERIFICATION CHECKS PASSED (100%)!");
    console.log("========================================================\n");
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
