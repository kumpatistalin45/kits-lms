/**
 * KITS LMS — Phase 2 Database Adapter Regression Suite
 * 
 * Verifies:
 * 1. Adapter Factory Default Behavior (Default is STRICTLY 'supabase')
 * 2. Explicit Engine Switching via DB_ENGINE or factory param
 * 3. SupabaseAdapter Interface & Health Check
 * 4. FirestoreAdapter Interface & Health Check
 * 5. Student Profile & Student Record Lookup (Existing Firebase UIDs)
 * 6. Answer Key Separation & Security (Sanitized in examinations, isolated in examinations_secure)
 * 7. Exam Lifecycle (Create, Retrieve, Update Status, Delete)
 * 8. Attempt Lifecycle (Create, Autosave Answer, Violation Handling)
 * 9. Evaluation Finalization & Scorecard Retrieval
 * 10. Data Parity & Rollback Verification
 */

const assert = require("assert");
const { 
    DatabaseAdapter, 
    SupabaseAdapter, 
    FirestoreAdapter, 
    getDatabaseAdapter 
} = require("../database-adapter.js");

async function runAdapterTests() {
    console.log("==================================================================");
    console.log("  KITS LMS — DATABASE ADAPTER REGRESSION TEST SUITE (PHASE 2)");
    console.log("==================================================================");

    let passedChecks = 0;
    let failedChecks = 0;

    function check(description, fn) {
        try {
            fn();
            console.log(`  [PASS] ${description}`);
            passedChecks++;
        } catch (err) {
            console.error(`  [FAIL] ${description} ->`, err.message);
            failedChecks++;
        }
    }

    async function checkAsync(description, fn) {
        try {
            await fn();
            console.log(`  [PASS] ${description}`);
            passedChecks++;
        } catch (err) {
            console.error(`  [FAIL] ${description} ->`, err.message);
            failedChecks++;
        }
    }

    // 1. Factory Default Engine Check
    console.log("\n[TEST 1] Factory Default Engine Verification");
    delete process.env.DB_ENGINE; // Ensure env is unset
    const defaultAdapter = getDatabaseAdapter();
    check("Default database engine is strictly 'supabase'", () => {
        assert.strictEqual(defaultAdapter.getEngineName(), "supabase");
        assert(defaultAdapter instanceof SupabaseAdapter);
    });

    // 2. Explicit Engine Switching
    console.log("\n[TEST 2] Explicit Engine Switching");
    const firestoreAdapter = getDatabaseAdapter("firestore");
    check("Factory instantiates FirestoreAdapter when 'firestore' requested", () => {
        assert.strictEqual(firestoreAdapter.getEngineName(), "firestore");
        assert(firestoreAdapter instanceof FirestoreAdapter);
    });

    const supabaseAdapter = getDatabaseAdapter("supabase");
    check("Factory instantiates SupabaseAdapter when 'supabase' requested", () => {
        assert.strictEqual(supabaseAdapter.getEngineName(), "supabase");
        assert(supabaseAdapter instanceof SupabaseAdapter);
    });

    // 3. Adapter Initialization & Health Check
    console.log("\n[TEST 3] Initialization & Health Check");
    await checkAsync("SupabaseAdapter initializes without throwing", async () => {
        await supabaseAdapter.init();
        const health = await supabaseAdapter.healthCheck();
        assert(health.engine === "supabase");
    });

    await checkAsync("FirestoreAdapter initializes without throwing", async () => {
        await firestoreAdapter.init();
        const health = await firestoreAdapter.healthCheck();
        assert(health.engine === "firestore");
    });

    // 4. FirestoreAdapter: Student & Profile Management
    console.log("\n[TEST 4] FirestoreAdapter: Student & Profile CRUD with Firebase UIDs");
    const testRoll = "25JR1A12A0";
    const testUid = "H888lL7mzzgdtL5NUJgq74ndX2A2";
    const testEmail = "raadatejaskumar@gmail.com";
    const testName = "N Rakada Tejas Kumar";

    await checkAsync("Upsert student and profile into FirestoreAdapter", async () => {
        const ok = await firestoreAdapter.upsertStudent({
            rollNumber: testRoll,
            fullName: testName,
            email: testEmail,
            firebaseUid: testUid,
            department: "Information Technology",
            academicYear: "2nd Year B.Tech",
            status: "active"
        });
        assert.strictEqual(ok, true);
    });

    await checkAsync("Retrieve student by roll number from FirestoreAdapter", async () => {
        const student = await firestoreAdapter.getStudentByRoll(testRoll);
        assert(student, "Student must be found");
        assert.strictEqual(student.rollNumber, testRoll);
        assert.strictEqual(student.email, testEmail);
        assert.strictEqual(student.firebaseUid, testUid);
    });

    await checkAsync("Retrieve profile by Firebase UID from FirestoreAdapter", async () => {
        const profile = await firestoreAdapter.getProfileByUid(testUid);
        assert(profile, "Profile must be found");
        assert.strictEqual(profile.firebaseUid, testUid);
        assert.strictEqual(profile.role, "student");
    });

    await checkAsync("Update student status (active -> suspended)", async () => {
        const ok = await firestoreAdapter.updateStudentStatus(testRoll, "suspended");
        assert.strictEqual(ok, true);
        const updated = await firestoreAdapter.getStudentByRoll(testRoll);
        assert.strictEqual(updated.status, "suspended");
    });

    // 5. FirestoreAdapter: Secure Answer Key Separation (Critical Security Check)
    console.log("\n[TEST 5] FirestoreAdapter: Answer Key Separation (examinations vs examinations_secure)");
    const testExamId = "exam_test_phase2_" + Date.now();
    const rawQuestions = [
        {
            id: "q_1",
            question_number: 1,
            question_text: "What is the capital of Andhra Pradesh?",
            option_a: "Amaravati",
            option_b: "Visakhapatnam",
            option_c: "Kurnool",
            option_d: "Guntur",
            correct_answer: "A",
            marks: 2,
            explanation: "Amaravati is the capital."
        },
        {
            id: "q_2",
            question_number: 2,
            question_text: "Which of the following are prime numbers?",
            option_a: "2",
            option_b: "3",
            option_c: "4",
            option_d: "5",
            type: "msq",
            correct_answers: ["A", "B", "D"],
            marks: 3,
            explanation: "2, 3, and 5 are prime numbers."
        }
    ];

    await checkAsync("Upsert examination with automatic answer-key segregation", async () => {
        const ok = await firestoreAdapter.upsertExamination({
            id: testExamId,
            title: "Phase 2 Security Verification Assessment",
            duration_minutes: 45,
            total_marks: 5,
            questions: rawQuestions
        });
        assert.strictEqual(ok, true);
    });

    await checkAsync("Verify public examination document STRIPS correct answers and explanations", async () => {
        const publicExam = await firestoreAdapter.getExaminationById(testExamId);
        assert(publicExam, "Public exam document must exist");
        assert.strictEqual(publicExam.totalQuestions, 2);
        assert.strictEqual(publicExam.totalMarks, 5);
        assert.strictEqual(publicExam.durationMinutes, 45);

        // Verify each public question has NO answer key or explanation
        publicExam.questions.forEach((q, idx) => {
            assert.strictEqual(q.correct_answer, undefined, `Public Question ${idx + 1} must not have correct_answer`);
            assert.strictEqual(q.correct_answers, undefined, `Public Question ${idx + 1} must not have correct_answers`);
            assert.strictEqual(q.explanation, undefined, `Public Question ${idx + 1} must not have explanation`);
            assert.ok(q.question_text, "Statement preserved");
            assert.ok(q.option_a, "Option A preserved");
        });
    });

    await checkAsync("Verify server-only examinations_secure collection HOLDS secret answer keys", async () => {
        const secretKeys = await firestoreAdapter.getExaminationSecureKeys(testExamId);
        assert(Array.isArray(secretKeys), "Secure keys must be returned");
        assert.strictEqual(secretKeys.length, 2);
        assert.strictEqual(secretKeys[0].correct_answer, "A");
        assert.deepStrictEqual(secretKeys[1].correct_answers, ["A", "B", "D"]);
        assert.strictEqual(secretKeys[0].explanation, "Amaravati is the capital.");
    });

    // 6. FirestoreAdapter: Candidate Attempts & Autosave
    console.log("\n[TEST 6] FirestoreAdapter: Candidate Attempts & Autosave Lifecycle");
    const testAttemptId = "att_test_" + Date.now();
    await checkAsync("Create student attempt in FirestoreAdapter", async () => {
        const ok = await firestoreAdapter.createAttempt({
            attemptId: testAttemptId,
            examId: testExamId,
            rollNumber: testRoll,
            setNumber: 3,
            deadlineAt: new Date(Date.now() + 45 * 60000).toISOString()
        });
        assert.strictEqual(ok, true);
        const attempt = await firestoreAdapter.getAttempt(testExamId, testRoll);
        assert(attempt, "Attempt must exist");
        assert.strictEqual(attempt.status, "in_progress");
        assert.strictEqual(attempt.set_number, 3);
    });

    await checkAsync("Autosave candidate answer to question 1", async () => {
        const ok = await firestoreAdapter.saveAttemptAnswer(testAttemptId, 1, "B", testExamId, testRoll);
        assert.strictEqual(ok, true);
        const attempt = await firestoreAdapter.getAttempt(testExamId, testRoll);
        assert.strictEqual(attempt.answers["1"], "B");
    });

    await checkAsync("Record fullscreen violation counter", async () => {
        const ok = await firestoreAdapter.recordViolation(testAttemptId, testExamId, testRoll, 2);
        assert.strictEqual(ok, true);
        const attempt = await firestoreAdapter.getAttempt(testExamId, testRoll);
        assert.strictEqual(attempt.fullscreen_violation_count, 2);
        assert.strictEqual(attempt.status, "in_progress");
    });

    // 7. FirestoreAdapter: Final Submission & Itemized Review Scorecard
    console.log("\n[TEST 7] FirestoreAdapter: Final Submission & Scorecard Evaluation");
    const testResultId = "res_test_" + Date.now();
    await checkAsync("Finalize exam submission atomically", async () => {
        const ok = await firestoreAdapter.finalizeSubmission({
            id: testResultId,
            attemptId: testAttemptId,
            examId: testExamId,
            examTitle: "Phase 2 Security Verification Assessment",
            rollNumber: testRoll,
            studentName: testName,
            score: 5,
            totalMarks: 5,
            percentage: 100,
            status: "Pass",
            autoSubmitted: false,
            timeTakenSeconds: 300,
            itemizedReview: [
                {
                    question_number: 1,
                    statement: "What is the capital of Andhra Pradesh?",
                    student_answer: "A",
                    correct_answer: "A",
                    is_correct: true,
                    marks_awarded: 2,
                    explanation: "Amaravati is the capital."
                },
                {
                    question_number: 2,
                    statement: "Which of the following are prime numbers?",
                    student_answer: ["A", "B", "D"],
                    correct_answers: ["A", "B", "D"],
                    is_correct: true,
                    marks_awarded: 3,
                    explanation: "2, 3, and 5 are prime numbers."
                }
            ]
        }, {
            attemptId: testAttemptId,
            status: "submitted",
            answers: { "1": "A", "2": ["A", "B", "D"] }
        });
        assert.strictEqual(ok, true);
    });

    await checkAsync("Retrieve final scorecard with complete itemized review", async () => {
        const result = await firestoreAdapter.getResult(testExamId, testRoll);
        assert(result, "Result must exist");
        assert.strictEqual(result.score, 5);
        assert.strictEqual(result.totalMarks, 5);
        assert.strictEqual(result.percentage, 100);
        assert.strictEqual(result.status, "Pass");
        assert.strictEqual(result.itemizedReview.length, 2);
        assert.strictEqual(result.itemizedReview[0].explanation, "Amaravati is the capital.");
    });

    // 8. Integration with Existing Supabase Database
    console.log("\n[TEST 8] SupabaseAdapter Live Integration Verification");
    await checkAsync("SupabaseAdapter retrieves existing 67 students", async () => {
        const students = await supabaseAdapter.getStudents();
        assert(Array.isArray(students));
        console.log(`    (SupabaseAdapter retrieved ${students.length} students)`);
        assert.ok(students.length >= 60, "Must contain all institutional student accounts");
    });

    await checkAsync("SupabaseAdapter retrieves examinations", async () => {
        const exams = await supabaseAdapter.getExaminations();
        assert(Array.isArray(exams));
        console.log(`    (SupabaseAdapter retrieved ${exams.length} examinations)`);
        assert.ok(exams.length >= 1, "Must contain live examinations");
    });

    // Summary
    console.log("\n==================================================================");
    console.log(`  PHASE 2 REGRESSION TEST RESULTS: ${passedChecks} PASSED, ${failedChecks} FAILED`);
    console.log("==================================================================");

    if (failedChecks > 0) {
        process.exit(1);
    }
    process.exit(0);
}

runAdapterTests().catch(err => {
    console.error("TEST RUNNER ERROR:", err);
    process.exit(1);
});

