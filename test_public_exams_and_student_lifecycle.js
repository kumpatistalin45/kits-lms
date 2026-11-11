/**
 * KITS Online Examination Platform
 * Verification Test: Public Exam Access + Student Suspension & Deletion Lifecycle
 */

const http = require("http");

const BASE_URL = "http://127.0.0.1:3000";

function request(options, postData) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
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
        if (postData) {
            req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function runTests() {
    console.log("==================================================================");
    console.log("KITS LMS: PUBLIC EXAM ACCESS + STUDENT LIFECYCLE AUTOMATED AUDIT");
    console.log("==================================================================\n");

    let testsPassed = 0;
    let testsTotal = 0;

    function assert(condition, testName, details = "") {
        testsTotal++;
        if (condition) {
            console.log(`  [PASS] Test ${testsTotal}: ${testName}`);
            testsPassed++;
        } else {
            console.error(`  [FAIL] Test ${testsTotal}: ${testName}`);
            if (details) console.error(`         Details: ${details}`);
        }
    }

    try {
        // Step 1: Admin Authentication
        console.log("--> 1. Testing Admin Authentication");
        const adminLoginRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/auth/admin-login",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, { username: "IT", password: "INFORMATIONTECHNOLOGY" });

        assert(adminLoginRes.status === 200 && adminLoginRes.body.token, "Admin login with 'IT' / 'INFORMATIONTECHNOLOGY' succeeds", JSON.stringify(adminLoginRes.body));
        const adminToken = adminLoginRes.body.token;

        // Step 2: Clean legacy courses
        console.log("\n--> 2. Testing Legacy Courses Cleanup (No LMS modules)");
        const cleanupRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/legacy/cleanup",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, { confirmationPhrase: "DELETE LEGACY COURSES" });
        assert(cleanupRes.status === 200 && cleanupRes.body.success, "Legacy LMS courses cleanly deleted");

        // Step 3: Create Universal Public Examination (Without Student Assignment)
        console.log("\n--> 3. Testing Public Exam Creation (No Student Assignment)");
        const testExamId = "exam_audit_" + Date.now();
        const activeStartTime = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const createExamRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/exams/create",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, {
            id: testExamId,
            title: "Universal Public Assessment 2026",
            duration_minutes: 60,
            scheduled_start_at: activeStartTime,
            status: "published"
            // Intentionally no cohort, no assigned_to_all, no assigned_student_rolls!
        });

        assert(createExamRes.status === 201 && createExamRes.body.exam.id === testExamId, "Public exam created without student assignment", JSON.stringify(createExamRes.body));
        assert(createExamRes.body.exam.total_questions === 50, "Exam has standard 50 MCQs");
        assert(createExamRes.body.exam.total_marks === 50, "Exam has standard 50 Marks");

        // Step 4: Automatic Visibility to Existing Active Students
        console.log("\n--> 4. Testing Universal Visibility for Existing Active Students");
        const student1Exams = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/student/assigned-exams?roll=22IT001`,
            method: "GET"
        });
        const hasExam1 = student1Exams.body.examinations && student1Exams.body.examinations.some(e => e.id === testExamId);
        assert(student1Exams.status === 200 && hasExam1, "Existing active student 22IT001 sees published exam automatically");

        const student2Exams = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/student/assigned-exams?roll=22IT002`,
            method: "GET"
        });
        const hasExam2 = student2Exams.body.examinations && student2Exams.body.examinations.some(e => e.id === testExamId);
        assert(student2Exams.status === 200 && hasExam2, "Existing active student 22IT002 sees published exam automatically");

        // Step 5: Automatic Visibility for Newly Registered Students
        console.log("\n--> 5. Testing Automatic Visibility for Newly Registered Student");
        const newRoll = "22IT" + Math.floor(100 + Math.random() * 899);
        const newEmail = newRoll.toLowerCase() + "@kits.edu";
        const regRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/auth/register-student",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            roll_number: newRoll,
            name: "Rajesh Kumar",
            email: newEmail,
            department: "Information Technology",
            academic_year: "3rd Year B.Tech",
            firebase_uid: "uid_audit_" + Date.now()
        });
        assert(regRes.status === 200 && regRes.body.success, `New student ${newRoll} registered successfully`, JSON.stringify(regRes.body));

        const studentNewExams = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/student/assigned-exams?roll=${newRoll}`,
            method: "GET"
        });
        const hasNewExam = studentNewExams.body.examinations && studentNewExams.body.examinations.some(e => e.id === testExamId);
        assert(studentNewExams.status === 200 && hasNewExam, "Newly registered student immediately sees published exam without manual assignment");

        // Step 6: Draft / Unpublished Exam Hidden From Students
        console.log("\n--> 6. Testing Unpublished / Draft Exam Hidden from Students");
        const draftExamId = "exam_draft_" + Date.now();
        await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/exams/create",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, {
            id: draftExamId,
            title: "Draft Assessment (Unpublished)",
            status: "draft"
        });

        const checkDraftVisibility = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/student/assigned-exams?roll=22IT001`,
            method: "GET"
        });
        const draftVisible = checkDraftVisibility.body.examinations && checkDraftVisibility.body.examinations.some(e => e.id === draftExamId);
        assert(!draftVisible, "Draft / Unpublished exam is NOT visible in student dashboard");

        // Step 7: Single Attempt Rule Enforcement
        console.log("\n--> 7. Testing Strict Single Attempt Enforcement");
        // Start exam for 22IT001
        const startRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/start",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: testExamId,
            rollNumber: "22IT001",
            studentName: "A. Srikanth"
        });
        assert(startRes.status === 200 && startRes.body.success, "Student 22IT001 starts exam attempt", JSON.stringify(startRes.body));
        const attemptId = startRes.body.attemptId;

        // Save answer
        const saveAnswerRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/save-answer",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            attemptId,
            examId: testExamId,
            rollNumber: "22IT001",
            questionId: "q_1",
            selectedOption: "A"
        });
        assert(saveAnswerRes.status === 200 && saveAnswerRes.body.success, "Candidate saves answer for question 1");

        // Submit exam
        const submitRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/submit",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            attemptId,
            examId: testExamId,
            rollNumber: "22IT001"
        });
        assert(submitRes.status === 200 && submitRes.body.success, "Exam submitted and scored", JSON.stringify(submitRes.body));

        // Attempt to retake exam
        const retakeRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/start",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: testExamId,
            rollNumber: "22IT001",
            studentName: "A. Srikanth"
        });
        assert((retakeRes.status === 409 || retakeRes.status === 400) && retakeRes.body.alreadySubmitted === true, "Retake blocked: strict single attempt enforced with alreadySubmitted: true");

        // Step 8: Student Suspension Lifecycle
        console.log("\n--> 8. Testing Student Suspension Lifecycle (Account Status: Suspended)");
        const suspendTarget = "22IT002";
        const suspendRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/students/suspend",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, { rollNumber: suspendTarget });
        assert(suspendRes.status === 200 && suspendRes.body.student.status === "suspended", `Admin suspends student ${suspendTarget}`);

        // Suspended student blocked from assigned-exams
        const suspAssignedRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/student/assigned-exams?roll=${suspendTarget}`,
            method: "GET"
        });
        assert(suspAssignedRes.status === 403 && suspAssignedRes.body.status === "suspended", "Suspended student blocked from /api/student/assigned-exams (HTTP 403)");

        // Suspended student blocked from starting exams
        const suspStartRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/start",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: testExamId,
            rollNumber: suspendTarget,
            studentName: "B. Bhavani"
        });
        assert(suspStartRes.status === 403 && suspStartRes.body.status === "suspended", "Suspended student blocked from /api/exams/start (HTTP 403)");

        // Suspended student blocked at login lookup
        const suspLookupRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/auth/student-lookup?identifier=${suspendTarget}`,
            method: "GET"
        });
        assert(suspLookupRes.status === 403 && suspLookupRes.body.status === "suspended", "Suspended student blocked at login student-lookup (HTTP 403)");

        // Suspended student blocked at verify-profile
        const suspProfileRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/auth/verify-profile`,
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            identifier: suspendTarget,
            firebaseUid: "uid_dummy"
        });
        assert(suspProfileRes.status === 403 && suspProfileRes.body.status === "suspended", "Suspended student blocked at verify-profile (HTTP 403)");

        // Step 9: Student Reactivation Lifecycle
        console.log("\n--> 9. Testing Student Reactivation Lifecycle (Account Status: Active)");
        const activateRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/students/activate",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, { rollNumber: suspendTarget });
        assert(activateRes.status === 200 && activateRes.body.student.status === "active", `Admin reactivates student ${suspendTarget}`);

        // Reactivated student can view exams again
        const reactivatedAssignedRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/student/assigned-exams?roll=${suspendTarget}`,
            method: "GET"
        });
        assert(reactivatedAssignedRes.status === 200 && reactivatedAssignedRes.body.examinations, "Reactivated student can view assigned exams again");

        // Step 10: Permanent Student Deletion Lifecycle (Strict Roll Typing + Institutional Retention)
        console.log("\n--> 10. Testing Student Deletion Lifecycle with Strict Roll Confirmation & Institutional Retention");
        const deleteTarget = "22DEL" + Math.floor(100 + Math.random() * 899);

        // Provision student record for deletion lifecycle
        await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/students/save",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, {
            roll_number: deleteTarget,
            name: "Candidate For Deletion",
            email: `${deleteTarget.toLowerCase()}@kits.edu`,
            department: "Information Technology",
            academic_year: "3rd Year B.Tech"
        });

        // Have candidate attempt and submit the exam first so we verify historical retention!
        const startTarget = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/start",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: testExamId,
            rollNumber: deleteTarget,
            studentName: "Candidate For Deletion"
        });
        await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/submit",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            attemptId: startTarget.body.attemptId,
            examId: testExamId,
            rollNumber: deleteTarget
        });

        // 10a. Attempt deletion with mismatching confirmation phrase
        const mismatchDelete = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/students/delete",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, {
            rollNumber: deleteTarget,
            confirmationRoll: "WRONG_ROLL_TYPED"
        });
        assert(mismatchDelete.status === 400, "Mismatched confirmation roll number is rejected (HTTP 400)");

        // 10b. Successful deletion with exact matching roll number
        const confirmDelete = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/students/delete",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, {
            rollNumber: deleteTarget,
            confirmationRoll: deleteTarget
        });
        assert(confirmDelete.status === 200 && confirmDelete.body.success, `Student ${deleteTarget} permanently deleted with confirmation`);
        assert(confirmDelete.body.resultsPreserved >= 1, `Institutional retention preserved ${confirmDelete.body.resultsPreserved} examination results`);

        // 10c. Deleted student cannot login or lookup
        const delLookup = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/auth/student-lookup?identifier=${deleteTarget}`,
            method: "GET"
        });
        assert(delLookup.status === 404, "Deleted student account returns 404 at login lookup");

        // 10d. Cannot re-register with same roll number
        const reregister = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/auth/register-student",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            roll_number: deleteTarget,
            name: "Impostor Account",
            email: "impostor@kits.edu"
        });
        assert(reregister.status === 409, "Re-registration with deleted roll number is strictly blocked (HTTP 409)");

        // Step 11: Exam Monitoring & Candidate Roster Inspection
        console.log("\n--> 11. Testing Exam Monitoring & Candidate Roster Metrics");
        const monitorRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: `/api/admin/exams/monitoring?examId=${testExamId}`,
            method: "GET",
            headers: { "Authorization": `Bearer ${adminToken}` }
        });
        assert(monitorRes.status === 200 && monitorRes.body.counts, "Exam monitoring endpoint returns counts and roster");
        const counts = monitorRes.body.counts;
        assert(counts.totalRegistered > 0, `Total Registered Students reported: ${counts.totalRegistered}`);
        assert(counts.totalEligible > 0, `Eligible Active Students reported: ${counts.totalEligible}`);
        assert(counts.submitted >= 2, `Submitted count reflects completed attempts: ${counts.submitted}`);

        // Verify institutional data retention in monitoring roster
        const preservedInRoster = monitorRes.body.candidates.find(c => c.roll_number === deleteTarget);
        assert(preservedInRoster && preservedInRoster.accountStatus === "deleted", `Deleted candidate ${deleteTarget} examination score and attempt preserved in roster for audit`);

        // Step 12: Students Management List Endpoint
        console.log("\n--> 12. Testing Students List with Account Statuses & Counts");
        const studentsListRes = await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/students",
            method: "GET",
            headers: { "Authorization": `Bearer ${adminToken}` }
        });
        assert(studentsListRes.status === 200 && Array.isArray(studentsListRes.body.students), "Students list endpoint returns all students");
        const stdList = studentsListRes.body.students;
        const activeStd = stdList.find(s => s.status === "active");
        const delStd = stdList.find(s => (s.roll_number || "").toUpperCase() === deleteTarget);
        assert(activeStd !== undefined, "Active student status reflected in students list");
        assert(delStd !== undefined && delStd.status === "deleted", `Deleted student ${deleteTarget} status is 'deleted' and record preserved in students list`);

        // Clean up test examination
        console.log("\n--> 13. Cleaning up test exam");
        await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/exams/delete",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, {
            examId: testExamId,
            confirmationPhrase: "CONFIRM DELETE"
        });
        await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/admin/exams/delete",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`
            }
        }, {
            examId: draftExamId,
            confirmationPhrase: "CONFIRM DELETE"
        });

        console.log("\n==================================================================");
        console.log(`TOTAL TESTS: ${testsTotal} | PASSED: ${testsPassed} | FAILED: ${testsTotal - testsPassed}`);
        console.log("==================================================================");

        if (testsPassed === testsTotal) {
            console.log("\n>>> ALL TESTS PASSED SUCCESSFULLY! 100% AUDIT COMPLIANCE! <<<");
            process.exit(0);
        } else {
            console.error(`\n>>> AUDIT FAILED: ${testsTotal - testsPassed} tests failed. <<<`);
            process.exit(1);
        }

    } catch (err) {
        console.error("\n[FATAL ERROR IN TEST SUITE]:", err);
        process.exit(1);
    }
}

runTests();
