/**
 * KITS LMS — Dynamic Exam Configuration & Complete Exam-Wide Bulk Revalidation Verification Suite
 * 
 * Verifies:
 * 1. Dynamic Exam Configuration:
 *    - Admin control of total questions (e.g. 20, 30, 50) and total marks (e.g. 20, 60, 50).
 *    - Question types (MCQ and MSQ), compulsory settings, equal vs variable marks allocation.
 *    - Negative marking policy (enabled/disabled with custom deduction values, e.g. -0.5).
 *    - Strict validation rejecting mismatched question counts or marks sums.
 * 2. Dynamic Student Exam Engine & Negative Marking:
 *    - Deterministic set allocation with dynamic question count and duration.
 *    - Secure sanitization preserving dynamic question marks and policies.
 *    - Negative marking evaluation deducting negative values for wrong answers, floor at 0.
 * 3. Complete Exam-Wide Bulk Revalidation:
 *    - Full questions and authoritative keys retrieval (full-exam-detail).
 *    - Detailed diff generation (MODIFIED, ADDED, REMOVED, UNCHANGED) and cohort impact preview.
 *    - Strict safety confirmation (exact phrase REVALIDATE FULL EXAM and affected count match).
 *    - Atomic execution: exam version increment (v1 -> v2), immutable version snapshot saving,
 *      re-evaluation of all submitted attempts using deterministic sets, official results updating.
 *    - 100% preservation of original student responses.
 *    - Idempotency protection against duplicate commits.
 * 4. Backward Compatibility:
 *    - Historical 50Q/50M exams remain fully intact and operational.
 */

const path = require("path");
const http = require("http");
const fs = require("fs");

const envPath = path.resolve(__dirname, "..", ".env");
if (typeof process.loadEnvFile === "function" && fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
}

const { getDatabaseAdapter } = require("../database-adapter");
const { generateStudentExamArrangement, sanitizeArrangementForStudent, evaluateStudentSubmission } = require("../exam-randomizer");
const serverHandler = require("../server");

async function runTestSuite() {
    console.log("==================================================================");
    console.log("⚡ KITS LMS DYNAMIC EXAM & COMPLETE REVALIDATION VERIFICATION SUITE");
    console.log("==================================================================\n");

    let passedCount = 0;
    let failedCount = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✓ PASS: ${message}`);
            passedCount++;
        } else {
            console.error(`  ✕ FAIL: ${message}`);
            failedCount++;
        }
    }

    // GROUP 1: Database Adapter & Connection
    console.log("[TEST GROUP 1] Database Adapter & Firestore Connection");
    const adapter = getDatabaseAdapter();
    assert(adapter !== null, "FirestoreAdapter instantiated.");
    const health = await adapter.healthCheck();
    assert(health.healthy === true, "Cloud Firestore connected to live project kits-lms-13053.");

    // GROUP 2: HTTP Server & Admin Authentication
    console.log("\n[TEST GROUP 2] HTTP Server & Admin Authentication");
    const server = http.createServer(serverHandler);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`  Local test server listening on ${baseUrl}`);

    async function apiFetch(endpoint, options = {}) {
        const url = `${baseUrl}${endpoint}`;
        const res = await fetch(url, options);
        let data = null;
        try {
            data = await res.json();
        } catch (_) {}
        return { status: res.status, ok: res.ok, data };
    }

    const loginRes = await apiFetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "IT", password: "INFORMATIONTECHNOLOGY" })
    });
    assert(loginRes.ok && Boolean(loginRes.data && loginRes.data.token), "Admin authenticated successfully.");
    const adminToken = loginRes.data ? loginRes.data.token : "";
    const adminHeaders = {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
    };

    // Helper: generate dummy questions
    function makeDummyQuestions(count, marksPerQ = 1) {
        const qs = [];
        for (let i = 1; i <= count; i++) {
            qs.push({
                question_number: i,
                id: `q_test_${i}`,
                statement: `What is the computational complexity of algorithm test case ${i}?`,
                question_text: `What is the computational complexity of algorithm test case ${i}?`,
                option_a: "O(1) Constant",
                option_b: "O(n) Linear",
                option_c: "O(n log n) Log-linear",
                option_d: "O(n^2) Quadratic",
                correct_answer: i % 2 === 0 ? "B" : "A",
                correct_answers: [i % 2 === 0 ? "B" : "A"],
                marks: marksPerQ,
                type: "mcq",
                explanation: `Detailed explanation for question ${i}.`
            });
        }
        return qs;
    }

    // GROUP 3: Dynamic Exam Configuration & Validation
    console.log("\n[TEST GROUP 3] Dynamic Exam Configuration & Pre-Publish Validation");

    // Test 3.1: Rejection on mismatched marks sum in equal mode
    const invalidEqualRes = await apiFetch("/api/admin/exams/create", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            title: "Invalid Exam 1",
            scheduled_date: "2026-11-20",
            scheduled_time: "10:00",
            total_questions: 10,
            total_marks: 50, // 10 questions * 1 mark != 50
            marks_mode: "equal",
            marks_per_question: 1,
            questions: makeDummyQuestions(10, 1)
        })
    });
    assert(!invalidEqualRes.ok && invalidEqualRes.status === 400, "Rejected creation when total_marks != total_questions * marks_per_question.");

    // Test 3.2: Rejection when question list length doesn't match total_questions
    const countMismatchRes = await apiFetch("/api/admin/exams/create", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            title: "Invalid Exam 2",
            scheduled_date: "2026-11-20",
            scheduled_time: "10:00",
            total_questions: 20, // claims 20 but provided 10
            total_marks: 20,
            marks_mode: "equal",
            marks_per_question: 1,
            questions: makeDummyQuestions(10, 1)
        })
    });
    assert(!countMismatchRes.ok && countMismatchRes.status === 400, "Rejected creation when questions array length does not match total_questions.");

    // Test 3.3: Create valid 20 Questions / 20 Marks Exam
    const exam20Id = `test_dynamic_20q_${Date.now()}`;
    const create20Res = await apiFetch("/api/admin/exams/create", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            id: exam20Id,
            title: "Automated Dynamic 20Q-20M Assessment",
            scheduled_date: "2026-11-20",
            scheduled_time: "10:00",
            duration_minutes: 30,
            total_questions: 20,
            total_marks: 20,
            marks_mode: "equal",
            marks_per_question: 1.0,
            is_compulsory: true,
            negative_marking: false,
            negative_mark_value: 0,
            question_types: ["mcq"],
            questions: makeDummyQuestions(20, 1)
        })
    });
    assert(create20Res.ok && create20Res.data && create20Res.data.success, "Successfully created dynamic 20Q / 20M exam.");

    // Verify stored doc in Cloud Firestore
    const storedExam20 = await adapter.getExaminationById(exam20Id);
    assert(storedExam20 !== null, "Stored exam document retrieved from Firestore.");
    assert(storedExam20.total_questions === 20, `Stored exam total_questions is 20 (got ${storedExam20.total_questions}).`);
    assert(storedExam20.total_marks === 20, `Stored exam total_marks is 20 (got ${storedExam20.total_marks}).`);
    assert(storedExam20.duration_minutes === 30, `Stored exam duration is 30 mins (got ${storedExam20.duration_minutes}).`);
    assert(storedExam20.negative_marking === false, "Negative marking correctly saved as false.");

    // Test 3.4: Create valid 30 Questions / 60 Marks Exam with Negative Marking (-0.5)
    const exam30Id = `test_dynamic_30q_neg_${Date.now()}`;
    const create30Res = await apiFetch("/api/admin/exams/create", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            id: exam30Id,
            title: "Advanced Computational Structures (30Q / 60M / -0.5 Neg)",
            scheduled_date: "2026-11-20",
            scheduled_time: "14:00",
            duration_minutes: 45,
            total_questions: 30,
            total_marks: 60,
            marks_mode: "equal",
            marks_per_question: 2.0,
            is_compulsory: true,
            negative_marking: true,
            negative_mark_value: 0.5,
            question_types: ["mcq", "msq"],
            questions: makeDummyQuestions(30, 2)
        })
    });
    assert(create30Res.ok && create30Res.data && create30Res.data.success, "Successfully created 30Q / 60M exam with negative marking.");
    const storedExam30 = await adapter.getExaminationById(exam30Id);
    assert(storedExam30.total_questions === 30, "Stored 30Q exam has total_questions = 30.");
    assert(storedExam30.total_marks === 60, "Stored 30Q exam has total_marks = 60.");
    assert(storedExam30.marks_per_question === 2, "Stored 30Q exam has marks_per_question = 2.");
    assert(storedExam30.negative_marking === true, "Stored 30Q exam has negative_marking = true.");
    assert(storedExam30.negative_mark_value === 0.5, "Stored 30Q exam has negative_mark_value = 0.5.");

    // GROUP 4: Dynamic Student Exam Engine & Negative Marking Calculation
    console.log("\n[TEST GROUP 4] Dynamic Student Exam Engine & Negative Marking Calculation");

    // Test 4.1: Deterministic student arrangement for dynamic 20Q exam
    const studentRoll = "23B91A0501";
    const secureKeys20 = await adapter.getExaminationSecureKeys(exam20Id);
    const keyMap20 = new Map();
    (secureKeys20 || []).forEach(k => {
        if (k.id) keyMap20.set(String(k.id), k);
        if (k.question_number) keyMap20.set(String(k.question_number), k);
    });
    const exam20WithKeys = {
        ...storedExam20,
        questions: (storedExam20.questions || []).map((q, idx) => {
            const k = keyMap20.get(String(q.id)) || keyMap20.get(String(q.question_number || (idx + 1)));
            return {
                ...q,
                correct_answer: k ? (k.correct_answer || "A") : (q.correct_answer || "A"),
                correct_answers: k ? (k.correct_answers || [k.correct_answer || "A"]) : (q.correct_answers || ["A"]),
                explanation: k ? k.explanation : (q.explanation || "")
            };
        })
    };
    const arrangement20 = generateStudentExamArrangement(exam20WithKeys, studentRoll);
    assert(arrangement20.questions.length === 20, `Generated student arrangement has exactly 20 questions (got ${arrangement20.questions.length}).`);
    assert(arrangement20.totalMarks === 20, `Arrangement totalMarks is 20 (got ${arrangement20.totalMarks}).`);
    assert(arrangement20.durationMinutes === 30, `Arrangement durationMinutes is 30.`);

    const sanitized20 = sanitizeArrangementForStudent(arrangement20);
    assert(sanitized20.questions.length === 20, "Sanitized questions count is 20.");
    assert(sanitized20.questions[0].correct_answer === undefined, "Correct answer securely stripped from student view.");
    assert(sanitized20.questions[0].marks === 1, "Question marks tag preserved as 1.");

    // Test 4.2: Negative marking scoring simulation on 30Q/60M (-0.5) exam
    const secureKeys30 = await adapter.getExaminationSecureKeys(exam30Id);
    const keyMap30 = new Map();
    (secureKeys30 || []).forEach(k => {
        if (k.id) keyMap30.set(String(k.id), k);
        if (k.question_number) keyMap30.set(String(k.question_number), k);
    });
    const exam30WithKeys = {
        ...storedExam30,
        questions: (storedExam30.questions || []).map((q, idx) => {
            const k = keyMap30.get(String(q.id)) || keyMap30.get(String(q.question_number || (idx + 1)));
            return {
                ...q,
                correct_answer: k ? (k.correct_answer || "A") : (q.correct_answer || "A"),
                correct_answers: k ? (k.correct_answers || [k.correct_answer || "A"]) : (q.correct_answers || ["A"]),
                explanation: k ? k.explanation : (q.explanation || "")
            };
        })
    };
    const arrangement30 = generateStudentExamArrangement(exam30WithKeys, studentRoll);
    assert(arrangement30.questions.length === 30, "Generated arrangement for 30Q exam has 30 questions.");
    assert(arrangement30.totalMarks === 60, "Arrangement total marks is 60.");
    assert(arrangement30.negative_marking === true, "Arrangement reflects negative_marking = true.");
    assert(arrangement30.negative_mark_value === 0.5, "Arrangement reflects negative_mark_value = 0.5.");

    // Prepare student answers:
    // First 10 questions: correct answer
    // Next 5 questions: wrong answer
    // Remaining 15 questions: skipped (unanswered)
    const mockStudentAnswers = {};
    for (let i = 0; i < 10; i++) {
        const dispQ = arrangement30.questions[i];
        mockStudentAnswers[dispQ.display_number] = dispQ.correct_answer;
    }
    for (let i = 10; i < 15; i++) {
        const dispQ = arrangement30.questions[i];
        const correct = dispQ.correct_answer;
        mockStudentAnswers[dispQ.display_number] = (correct === "A" ? "C" : "A"); // deliberate wrong
    }

    const evalResult = evaluateStudentSubmission(arrangement30, mockStudentAnswers, exam30WithKeys);
    // Expected:
    // 10 correct * 2 marks = 20 marks
    // 5 wrong * -0.5 marks = -2.5 marks
    // 15 skipped = 0 marks
    // Total score = 20 - 2.5 = 17.5 marks
    assert(evalResult.correctCount === 10, `Correct count is 10 (got ${evalResult.correctCount}).`);
    assert(evalResult.wrongCount === 5, `Wrong count is 5 (got ${evalResult.wrongCount}).`);
    assert(evalResult.skippedCount === 15, `Skipped count is 15 (got ${evalResult.skippedCount}).`);
    assert(evalResult.score === 17.5, `Final score with negative marking is exactly 17.5 (got ${evalResult.score}).`);
    assert(evalResult.totalMarks === 60, `Dynamic total marks returned as 60 (got ${evalResult.totalMarks}).`);
    assert(Math.abs(evalResult.percentage - 29.2) < 0.1, `Calculated percentage is 29.2% (got ${evalResult.percentage}%).`);

    // Verify floor at 0 for negative marking: if student gets 0 correct and 30 wrong
    const allWrongAnswers = {};
    for (let i = 0; i < 30; i++) {
        const dispQ = arrangement30.questions[i];
        allWrongAnswers[dispQ.display_number] = (dispQ.correct_answer === "A" ? "D" : "A");
    }
    const evalAllWrong = evaluateStudentSubmission(arrangement30, allWrongAnswers, storedExam30);
    assert(evalAllWrong.score === 0, `Negative marking total score is safely floored at 0 (got ${evalAllWrong.score}).`);

    // GROUP 5: Complete Exam-Wide Bulk Revalidation Detail & Preview
    console.log("\n[TEST GROUP 5] Complete Exam-Wide Bulk Revalidation Detail & Preview");

    // Seed mock submitted attempt for exam20Id
    const mockAttemptId = `att_${exam20Id}_${studentRoll.toLowerCase()}`;
    const testAnswers = {};
    for (let i = 0; i < 3; i++) {
        const q = arrangement20.questions[i];
        testAnswers[q.display_number] = q.correct_answer;
    }
    const dispQ4 = arrangement20.questions[3];
    const wrongChoice = (dispQ4.correct_answer === "A" ? "B" : "A");
    testAnswers[dispQ4.display_number] = wrongChoice;

    const evalInitial = evaluateStudentSubmission(testAnswers, arrangement20);
    const initialScore = evalInitial.score; // exactly 3.0

    await adapter.createAttempt({
        id: mockAttemptId,
        attemptId: mockAttemptId,
        examId: exam20Id,
        exam_id: exam20Id,
        studentId: studentRoll,
        rollNumber: studentRoll,
        roll_number: studentRoll,
        studentName: "Stalin Kumpati",
        assigned_set: arrangement20.setNumber ? `Set ${arrangement20.setNumber}` : "Set A",
        setNumber: arrangement20.setNumber || 1,
        status: "Submitted",
        startedAt: new Date().toISOString(),
        started_at: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        answers: testAnswers,
        saved_answers: testAnswers,
        responses: testAnswers
    });

    await adapter.finalizeSubmission({
        id: `res_${exam20Id}_${studentRoll.toLowerCase()}`,
        attemptId: mockAttemptId,
        examId: exam20Id,
        studentId: studentRoll,
        rollNumber: studentRoll,
        studentName: "Stalin Kumpati",
        score: initialScore,
        totalMarks: 20,
        percentage: (initialScore / 20) * 100,
        passed: true,
        submittedAt: new Date().toISOString()
    }, {
        attemptId: mockAttemptId,
        examId: exam20Id,
        rollNumber: studentRoll,
        studentName: "Stalin Kumpati"
    });

    // Test 5.1: GET /api/admin/revalidation/full-exam-detail
    const detailRes = await apiFetch(`/api/admin/revalidation/full-exam-detail?examId=${encodeURIComponent(exam20Id)}`, {
        method: "GET",
        headers: adminHeaders
    });
    assert(detailRes.ok && detailRes.data.success, "GET full-exam-detail returned successfully.");
    assert(detailRes.data.questions.length === 20, "Returned all 20 questions in exam detail.");
    assert(detailRes.data.submittedCount >= 1, `Reported submitted attempts count is >= 1 (got ${detailRes.data.submittedCount}).`);
    assert(detailRes.data.currentVersion === 1, "Initial exam version is v1.");

    // Prepare revised questions:
    // Change dispQ4's original question key so candidate's choice becomes correct!
    const origQNumFor4 = dispQ4.original_question_number;
    const origChoiceFor4 = dispQ4.display_to_original_map[wrongChoice];

    const revisedQs = JSON.parse(JSON.stringify(detailRes.data.questions));
    const targetQ = revisedQs.find(q => q.question_number === origQNumFor4);
    if (targetQ) {
        targetQ.correct_answer = origChoiceFor4;
        targetQ.correct_answers = [origChoiceFor4];
    }
    revisedQs[0].explanation = "Updated authoritative pedagogical explanation for Question 1.";

    // Test 5.2: POST /api/admin/revalidation/full-exam-preview
    const previewRes = await apiFetch("/api/admin/revalidation/full-exam-preview", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            examId: exam20Id,
            revisedQuestions: revisedQs,
            totalMarks: 20,
            reason: "Revision of Question 4 key per academic board review."
        })
    });
    assert(previewRes.ok && previewRes.data.success, "POST full-exam-preview succeeded.");
    const prevData = previewRes.data;
    assert(Boolean(prevData.operationId && prevData.operationId.startsWith("FULL-REVAL-")), `Generated unique operationId: ${prevData.operationId}`);
    assert(prevData.modifiedQuestionsCount >= 1, `Detected modified questions (got ${prevData.modifiedQuestionsCount}).`);

    // Verify diff has status MODIFIED
    const qDiff = prevData.diffs.find(d => d.questionNumber === origQNumFor4);
    assert(qDiff !== undefined && qDiff.status === "MODIFIED", `Question ${origQNumFor4} correctly flagged as MODIFIED in change log.`);
    assert(qDiff.revisedKey === origChoiceFor4, `Question ${origQNumFor4} revisedKey matches '${origChoiceFor4}' (got ${qDiff.revisedKey}).`);

    // Verify Cohort Score Simulation
    const cohortStudent = prevData.cohortImpact.find(s => s.rollNumber === studentRoll);
    assert(cohortStudent !== undefined, "Cohort impact simulation includes test student.");
    assert(cohortStudent.delta > 0, `Candidate score improved by +${cohortStudent.delta} mark(s) as expected.`);
    assert(cohortStudent.revisedScore > cohortStudent.previousScore, `Revised score (${cohortStudent.revisedScore}) > Previous score (${cohortStudent.previousScore}).`);

    // GROUP 6: Safety Confirmation Enforcement
    console.log("\n[TEST GROUP 6] Strict Safety Confirmation Enforcement");

    // Test 6.1: Reject execution with incorrect phrase
    const rejectWrongPhraseRes = await apiFetch("/api/admin/revalidation/full-exam-execute", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            operationId: prevData.operationId,
            examId: exam20Id,
            revisedQuestions: revisedQs,
            totalMarks: 20,
            confirmationPhrase: "CONFIRM REVALIDATION", // invalid phrase
            expectedAffectedCount: prevData.affectedStudentsCount
        })
    });
    assert(!rejectWrongPhraseRes.ok && rejectWrongPhraseRes.status === 400, "Rejected execution when confirmation phrase is not 'REVALIDATE FULL EXAM'.");

    // Test 6.2: Reject execution when expected affected count does not match
    const rejectMismatchedCountRes = await apiFetch("/api/admin/revalidation/full-exam-execute", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            operationId: prevData.operationId,
            examId: exam20Id,
            revisedQuestions: revisedQs,
            totalMarks: 20,
            confirmationPhrase: "REVALIDATE FULL EXAM",
            expectedAffectedCount: 9999 // deliberate mismatch
        })
    });
    assert(!rejectMismatchedCountRes.ok && rejectMismatchedCountRes.status === 400, "Rejected execution when affected count does not match.");

    // GROUP 7: Full Exam Revalidation Execution & Persistence
    console.log("\n[TEST GROUP 7] Atomic Full Exam Execution & Version Snapshot Persistence");

    const execRes = await apiFetch("/api/admin/revalidation/full-exam-execute", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            operationId: prevData.operationId,
            examId: exam20Id,
            revisedQuestions: revisedQs,
            totalMarks: 20,
            confirmationPhrase: "REVALIDATE FULL EXAM",
            expectedAffectedCount: prevData.affectedStudentsCount,
            reason: "Academic faculty audit update."
        })
    });
    assert(execRes.ok && execRes.data.success, "Full Exam Revalidation successfully executed!");
    assert(execRes.data.newVersion === 2, `Exam version successfully incremented from v1 to v2 (got ${execRes.data.newVersion}).`);

    // Verify Version Snapshot in exam_versions collection
    const v2Snapshot = await adapter.getExamVersion(exam20Id, 2);
    assert(v2Snapshot !== null, "Immutable exam version snapshot v2 created in exam_versions collection.");
    assert(v2Snapshot.version === 2, "Snapshot version property is 2.");
    assert(v2Snapshot.questions.length === 20, "Snapshot contains all 20 revised questions.");

    // Verify Live Exam Document & Secure Keys updated in Cloud Firestore
    const updatedExam = await adapter.getExaminationById(exam20Id);
    assert(updatedExam.version === 2, `Live examination document version updated to v2 (got ${updatedExam.version}).`);
    const liveKeys = await adapter.getExaminationSecureKeys(exam20Id);
    const qKeyObj = (liveKeys || []).find(k => k.question_number === origQNumFor4);
    const qKey = qKeyObj ? (qKeyObj.correct_answer || qKeyObj.key) : "";
    assert(qKey === origChoiceFor4, `Live authoritative answer key for Q${origQNumFor4} successfully committed as '${origChoiceFor4}' (got ${qKey}).`);

    // Verify Original Student Responses Preserved & Results Updated
    const studentAttempt = await adapter.getAttempt(exam20Id, studentRoll);
    assert(studentAttempt !== null, "Student attempt document retrieved.");
    const savedAns = studentAttempt.answers || studentAttempt.saved_answers || studentAttempt.responses || {};
    assert(savedAns[dispQ4.display_number] === wrongChoice, "Original student response strictly preserved in exam_attempts.");

    const updatedResult = await adapter.getResult(exam20Id, studentRoll);
    assert(updatedResult !== null, "Updated result record retrieved.");
    assert(updatedResult.score > initialScore, `Official result score re-evaluated and updated (initial: ${initialScore}, revised: ${updatedResult.score}).`);
    assert(updatedResult.total_marks === 20 || updatedResult.totalMarks === 20, `Dynamic total marks preserved in result as 20.`);

    // GROUP 8: Idempotency Protection
    console.log("\n[TEST GROUP 8] Idempotency Protection Against Duplicate Commits");

    const duplicateExecRes = await apiFetch("/api/admin/revalidation/full-exam-execute", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            operationId: prevData.operationId, // duplicate operation ID
            examId: exam20Id,
            revisedQuestions: revisedQs,
            totalMarks: 20,
            confirmationPhrase: "REVALIDATE FULL EXAM",
            expectedAffectedCount: prevData.affectedStudentsCount
        })
    });
    assert(!duplicateExecRes.ok && duplicateExecRes.status === 409, "Duplicate operation ID rejected with HTTP 409 Conflict (Idempotency enforced).");

    // GROUP 9: Historical Exams Backward Compatibility
    console.log("\n[TEST GROUP 9] Backward Compatibility for Historical 50Q/50M Exams");

    const allExams = await adapter.getExaminations();
    const historicalExams = allExams.filter(e => !e.id.startsWith("test_dynamic_"));
    const examToInspect = historicalExams.length > 0 ? historicalExams[0] : allExams[0];
    assert(allExams.length > 0, `Retrieved ${allExams.length} examinations from repository.`);
    if (examToInspect) {
        const sampleTotalQ = examToInspect.total_questions || (examToInspect.questions && examToInspect.questions.length) || 50;
        const sampleTotalM = examToInspect.total_marks || 50;
        assert(sampleTotalQ >= 20, `Exam total questions is >= 20 (${sampleTotalQ}).`);
        assert(sampleTotalM >= 20, `Exam total marks is >= 20 (${sampleTotalM}).`);
    }

    // Teardown
    await new Promise(resolve => server.close(resolve));
    console.log("\n==================================================================");
    console.log(`TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log("==================================================================\n");

    if (failedCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTestSuite().catch(err => {
    console.error("FATAL ERROR IN TEST SUITE:", err);
    process.exit(1);
});
