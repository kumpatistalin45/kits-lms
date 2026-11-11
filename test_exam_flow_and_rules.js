// test_exam_flow_and_rules.js
// Verification suite for KITS Examination Platform - Original Exam Pattern & Rules
const http = require('http');

const BASE_URL = 'http://127.0.0.1:3000';

function makeRequest(path, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const reqHeaders = { 'Content-Type': 'application/json', ...headers };
        const req = http.request(url, { method, headers: reqHeaders }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error("Assertion Failed: " + message);
    }
    console.log("  [PASS] " + message);
}

async function runTests() {
    console.log("==================================================================");
    console.log("  KITS LMS - EXAMINATION PATTERN & RULES VERIFICATION SUITE");
    console.log("==================================================================");

    let totalTests = 0;
    let passedTests = 0;

    async function testCase(name, fn) {
        totalTests++;
        console.log(`\nTEST ${totalTests}: ${name}`);
        try {
            await fn();
            passedTests++;
        } catch (e) {
            console.error(`  [FAIL] ${name}`);
            console.error(`         ${e.message}`);
        }
    }

    const runId = Date.now();
    const testExamId = "exam_rules_" + runId;
    const student1Roll = "22IT_VIOLATION_" + runId;
    const student1Name = "Violation Candidate " + runId;

    const student2Roll = "22IT_NORMAL_" + runId;
    const student2Name = "Normal Candidate " + runId;

    const student3Roll = "22IT_TIMEOUT_" + runId;
    const student3Name = "Timeout Candidate " + runId;

    // Setup: Admin Login & Provision Published 50-MCQ Exam Active Now
    console.log("\n--> Setup: Admin Authentication & Exam Provisioning");
    const adminLogin = await makeRequest("/api/auth/admin-login", "POST", {
        username: "IT",
        password: "INFORMATIONTECHNOLOGY"
    });
    assert(adminLogin.status === 200 && adminLogin.body.token, "Admin login succeeded with IT credentials");
    const adminToken = adminLogin.body.token;

    const createExamRes = await makeRequest("/api/admin/exams/create", "POST", {
        id: testExamId,
        title: "KITS Comprehensive Rules Assessment " + runId,
        duration_minutes: 60,
        scheduled_start_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // started 2 mins ago
        status: "published"
    }, { "Authorization": `Bearer ${adminToken}` });
    assert(createExamRes.status === 201 && createExamRes.body.exam.id === testExamId, "Published 50-MCQ Exam provisioned successfully");

    // Provision Candidates
    await makeRequest("/api/auth/register-student", "POST", {
        roll_number: student1Roll,
        name: student1Name,
        email: `${student1Roll.toLowerCase()}@kits.edu`,
        department: "Information Technology"
    });
    await makeRequest("/api/auth/register-student", "POST", {
        roll_number: student2Roll,
        name: student2Name,
        email: `${student2Roll.toLowerCase()}@kits.edu`,
        department: "Information Technology"
    });
    await makeRequest("/api/auth/register-student", "POST", {
        roll_number: student3Roll,
        name: student3Name,
        email: `${student3Roll.toLowerCase()}@kits.edu`,
        department: "Information Technology"
    });
    console.log("  ✓ Candidates provisioned successfully.\n");

    // TEST 1: Initial Terms Status Check
    await testCase("Candidate initial terms acceptance status should be false", async () => {
        const res = await makeRequest(`/api/exams/terms-status?examId=${testExamId}&roll=${student1Roll}`);
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.termsAccepted === false, "Terms should not be accepted initially");
        assert(res.body.canAttempt === true, "Candidate should be eligible to attempt");
    });

    // TEST 2: Accept Terms & Conditions
    await testCase("Candidate accepts examination terms and rules", async () => {
        const res = await makeRequest("/api/exams/accept-terms", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            studentName: student1Name
        });
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.success === true, "Accept terms succeeded");
        assert(res.body.termsAccepted === true, "termsAccepted is true");
        assert(Boolean(res.body.termsAcceptedAt || res.body.acceptedAt), "termsAcceptedAt timestamp returned");
    });

    // TEST 3: Verify Idempotent Terms Status
    await testCase("Verify terms status returns accepted", async () => {
        const res = await makeRequest(`/api/exams/terms-status?examId=${testExamId}&roll=${student1Roll}`);
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.termsAccepted === true, "Terms verified as accepted");
    });

    // TEST 4: Start Exam Session
    let attempt1Id = null;
    await testCase("Candidate starts examination and receives 50 sanitized MCQs", async () => {
        const res = await makeRequest("/api/exams/start", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            studentName: student1Name
        });
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.success === true, "Exam start succeeded");
        assert(res.body.questions && res.body.questions.length === 50, "Received exactly 50 MCQs");
        assert(res.body.questions[0].correct_answer === undefined, "Security check: correct_answer is sanitized/omitted");
        assert(res.body.fullscreenViolationCount === 0, "Initial violation count is 0");
        attempt1Id = res.body.attemptId;
        assert(Boolean(attempt1Id), "AttemptId generated: " + attempt1Id);
    });

    // TEST 5: First Fullscreen Exit (Warning 1)
    await testCase("First Fullscreen Exit Violation triggers Warning 1 of 3", async () => {
        const res = await makeRequest("/api/exams/violation", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            attemptId: attempt1Id
        });
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.success === true, "Violation endpoint succeeded");
        assert(res.body.violationCount === 1, "Violation count is 1");
        assert(res.body.terminated === false, "Attempt is not terminated yet");
    });

    // TEST 6: Second Fullscreen Exit (Warning 2)
    await testCase("Second Fullscreen Exit Violation triggers Warning 2 of 3", async () => {
        const res = await makeRequest("/api/exams/violation", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            attemptId: attempt1Id
        });
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.success === true, "Violation endpoint succeeded");
        assert(res.body.violationCount === 2, "Violation count is 2");
        assert(res.body.terminated === false, "Attempt is not terminated yet");
    });

    // TEST 7: Third Fullscreen Exit (Strike 3 - Examination Terminated)
    await testCase("Third Fullscreen Exit Violation terminates examination immediately", async () => {
        const res = await makeRequest("/api/exams/violation", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            attemptId: attempt1Id
        });
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.success === true, "Violation endpoint succeeded");
        assert(res.body.violationCount === 3, "Violation count is 3");
        assert(res.body.terminated === true, "Attempt is terminated");
        assert(res.body.reason === "Three fullscreen violations", "Reason: Three fullscreen violations");
    });

    // TEST 8: Verify Attempt Locking - Cannot Save Answers
    await testCase("Terminated attempt rejects answer autosave with HTTP 403", async () => {
        const res = await makeRequest("/api/exams/save-answer", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            attemptId: attempt1Id,
            questionNumber: 5,
            selectedOption: "B"
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
        assert(res.body.terminated === true, "Rejected due to termination");
    });

    // TEST 9: Verify Attempt Locking - Cannot Submit
    await testCase("Terminated attempt rejects manual submit with HTTP 403", async () => {
        const res = await makeRequest("/api/exams/submit", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            studentName: student1Name,
            attemptId: attempt1Id,
            answers: { "1": "A", "2": "B" }
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
        assert(res.body.terminated === true, "Rejected due to termination");
    });

    // TEST 10: Verify Attempt Locking - Retakes Permanently Prohibited
    await testCase("Terminated attempt rejects retake / restart with HTTP 403", async () => {
        const res = await makeRequest("/api/exams/start", "POST", {
            examId: testExamId,
            rollNumber: student1Roll,
            studentName: student1Name
        });
        assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
        assert(res.body.terminated === true, "Retake blocked due to termination");
    });

    // TEST 11: Terminated Results Verification (Score = 0, Status = Terminated)
    await testCase("Result endpoint returns Score 0 and Status Terminated for student 1", async () => {
        const res = await makeRequest(`/api/exams/result?examId=${testExamId}&roll=${student1Roll}`);
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        assert(res.body.success === true, "Result retrieved");
        assert(res.body.result.status === "Terminated", `Expected status 'Terminated', got '${res.body.result.status}'`);
        assert(res.body.result.score === 0, `Expected score 0, got ${res.body.result.score}`);
        assert(res.body.result.termination_reason === "Three fullscreen violations", "Verified termination reason");
    });

    // TEST 12: Normal Student Full Examination Flow
    let attempt2Id = null;
    await testCase("Normal Student accepts terms, starts exam, saves answers, and submits", async () => {
        // Step 1: Accept terms
        const termsRes = await makeRequest("/api/exams/accept-terms", "POST", {
            examId: testExamId,
            rollNumber: student2Roll,
            studentName: student2Name
        });
        assert(termsRes.status === 200, "Terms accepted");

        // Step 2: Start exam
        const startRes = await makeRequest("/api/exams/start", "POST", {
            examId: testExamId,
            rollNumber: student2Roll,
            studentName: student2Name
        });
        assert(startRes.status === 200, "Started exam");
        attempt2Id = startRes.body.attemptId;

        // Step 3: Save answers for questions 1..10
        for (let q = 1; q <= 10; q++) {
            const saveRes = await makeRequest("/api/exams/save-answer", "POST", {
                examId: testExamId,
                rollNumber: student2Roll,
                attemptId: attempt2Id,
                questionNumber: q,
                selectedOption: "A"
            });
            assert(saveRes.status === 200, `Saved answer for Q${q}`);
        }

        // Step 4: Submit Exam
        const submitRes = await makeRequest("/api/exams/submit", "POST", {
            examId: testExamId,
            rollNumber: student2Roll,
            studentName: student2Name,
            attemptId: attempt2Id,
            answers: { "1": "A", "2": "A", "3": "A", "4": "A", "5": "A" },
            autoSubmitted: false
        });
        assert(submitRes.status === 200, "Submission succeeded");
        assert(submitRes.body.result.totalMarks === 50, "Total marks 50");
        assert(submitRes.body.result.totalQuestions === 50, "Total questions 50");
        assert(submitRes.body.result.autoSubmitted === false, "autoSubmitted is false");
        assert(submitRes.body.result.itemizedReview.length === 50, "50 itemized reviews generated");
    });

    // TEST 13: Normal Student Idempotent Submission & Retake Lockout
    await testCase("Normal Student duplicate submission is idempotent and retake is blocked", async () => {
        const dupRes = await makeRequest("/api/exams/submit", "POST", {
            examId: testExamId,
            rollNumber: student2Roll,
            studentName: student2Name,
            attemptId: attempt2Id,
            answers: {}
        });
        assert(dupRes.status === 200, "Duplicate submission handled idempotently");
        assert(dupRes.body.duplicatePrevented === true, "duplicatePrevented flag true");

        const retakeRes = await makeRequest("/api/exams/start", "POST", {
            examId: testExamId,
            rollNumber: student2Roll,
            studentName: student2Name
        });
        assert(retakeRes.status === 409, `Expected 409 Conflict, got ${retakeRes.status}`);
        assert(retakeRes.body.alreadySubmitted === true, "Retake strictly blocked");
    });

    // TEST 14: Timeout Auto-Submit Flow for Student 3
    await testCase("Timeout auto-submission correctly marks autoSubmitted: true", async () => {
        await makeRequest("/api/exams/accept-terms", "POST", {
            examId: testExamId,
            rollNumber: student3Roll,
            studentName: student3Name
        });
        const startRes = await makeRequest("/api/exams/start", "POST", {
            examId: testExamId,
            rollNumber: student3Roll,
            studentName: student3Name
        });
        const attempt3Id = startRes.body.attemptId;

        const autoSubRes = await makeRequest("/api/exams/submit", "POST", {
            examId: testExamId,
            rollNumber: student3Roll,
            studentName: student3Name,
            attemptId: attempt3Id,
            answers: { "1": "B", "2": "C" },
            autoSubmitted: true
        });
        assert(autoSubRes.status === 200, "Auto-submit succeeded");
        assert(autoSubRes.body.result.autoSubmitted === true, "Result marked autoSubmitted = true");

        // Verify result endpoint reflects autoSubmitted
        const resLookup = await makeRequest(`/api/exams/result?examId=${testExamId}&roll=${student3Roll}`);
        assert(resLookup.status === 200, "Result lookup OK");
        assert(resLookup.body.result.autoSubmitted === true, "Scorecard has autoSubmitted: true");
    });

    // TEST 15: Student Assigned Exams List reflects terms & attempt status
    await testCase("Student assigned exams API reflects termsAccepted and attemptStatus", async () => {
        const res = await makeRequest(`/api/student/assigned-exams?roll=${student1Roll}`);
        assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
        const list = res.body.exams || res.body.examinations || res.body.assignedExams || [];
        assert(Array.isArray(list), "Exams array returned");
        const ex = list.find(e => e.id === testExamId);
        assert(Boolean(ex), "Assigned exam found");
        assert(ex.termsAccepted === true, "termsAccepted is true in assigned-exams");
        assert(ex.studentStatus === "terminated", `Expected studentStatus 'terminated', got '${ex.studentStatus}'`);
    });

    console.log("\n==================================================================");
    console.log(`  VERIFICATION RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log("==================================================================");

    if (passedTests === totalTests) {
        console.log("  >>> ALL EXAMINATION PATTERN & RULES TESTS PASSED SUCCESSFULLY! <<<");
    } else {
        throw new Error(`${totalTests - passedTests} tests failed.`);
    }
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
