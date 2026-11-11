/**
 * KITS LMS: Verification of Active-Only Student Export & Anonymized Retention
 */

const http = require("http");

function request(options, postData) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
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
        if (postData) {
            req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function runAudit() {
    console.log("==================================================================");
    console.log("AUDIT: ACTIVE-ONLY STUDENT EXPORT & RETENTION ANONYMIZATION");
    console.log("==================================================================\n");

    let passed = 0;
    let failed = 0;

    function assert(cond, name, msg = "") {
        if (cond) {
            console.log(`  [PASS] ${name}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${name}`);
            if (msg) console.error(`         Details: ${msg}`);
            failed++;
        }
    }

    // 1. Admin login
    const loginRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/auth/admin-login",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, { username: "IT", password: "INFORMATIONTECHNOLOGY" });

    const adminToken = loginRes.body && loginRes.body.token;
    assert(loginRes.status === 200 && adminToken, "1. Admin authentication succeeds");

    // 2. Set up test students: 1 active, 1 suspended, 1 deleted
    const rollActive = "22ACT" + Math.floor(100 + Math.random() * 899);
    const rollSuspended = "22SUS" + Math.floor(100 + Math.random() * 899);
    const rollDeleted = "22DEL" + Math.floor(100 + Math.random() * 899);

    // Register 3 students
    for (const roll of [rollActive, rollSuspended, rollDeleted]) {
        await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/auth/register-student",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            roll_number: roll,
            name: "Candidate " + roll,
            email: roll.toLowerCase() + "@kits.edu",
            department: "Information Technology",
            academic_year: "3rd Year B.Tech",
            firebase_uid: "uid_" + roll
        });
    }

    // Suspend rollSuspended
    await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/admin/students/suspend",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${adminToken}`
        }
    }, { roll: rollSuspended, reason: "Audit verification" });

    // Fetch active published exam or create one
    const examsRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/admin/exams",
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
    });
    const now = Date.now();
    let exam = (examsRes.body && examsRes.body.exams && examsRes.body.exams.find(e => e.status === "published" && new Date(e.scheduled_end_at || 0).getTime() > now));
    let examId = exam ? exam.id : "exam_standard_50mcq";
    if (!exam) {
        examId = "exam_export_test_" + Date.now();
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
            id: examId,
            title: "Export Test Exam",
            duration_minutes: 60,
            scheduled_start_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
            status: "published"
        });
    }
    const startRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/exams/start",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, {
        examId: examId,
        rollNumber: rollDeleted,
        studentName: "Candidate " + rollDeleted
    });
    const attemptId = startRes.body && startRes.body.attemptId;

    if (attemptId) {
        await request({
            hostname: "127.0.0.1",
            port: 3000,
            path: "/api/exams/submit",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: examId,
            rollNumber: rollDeleted,
            studentName: "Candidate " + rollDeleted,
            attemptId: attemptId,
            answers: { "1": "A", "2": "B", "3": "C" }
        });
    }

    // Delete rollDeleted with typed roll confirmation
    const delRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/admin/students/delete",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${adminToken}`
        }
    }, { roll: rollDeleted, confirmRoll: rollDeleted });

    assert(delRes.status === 200 && delRes.body.success, "2. Student permanently deleted with confirmation");

    // 3. Test /api/admin/students/export (Backend Query-Level Filtering)
    const exportRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/admin/students/export",
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
    });

    assert(exportRes.status === 200 && exportRes.body.success, "3. /api/admin/students/export returns 200 OK");
    const exportStudents = exportRes.body.students || [];

    const hasActive = exportStudents.some(s => s.roll_number === rollActive);
    const hasSuspended = exportStudents.some(s => s.roll_number === rollSuspended);
    const hasDeleted = exportStudents.some(s => s.roll_number === rollDeleted);

    assert(hasActive, "4. Active student is present in student export");
    assert(!hasSuspended, "5. Suspended student is STRICTLY EXCLUDED from student export");
    assert(!hasDeleted, "6. Deleted student is STRICTLY EXCLUDED from student export");

    const allRowsActive = exportStudents.every(s => (s.status || "active").toLowerCase() === "active");
    assert(allRowsActive, "7. All exported rows have Account Status = 'active'");

    // 4. Test /api/admin/students?status=active
    const filteredRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/admin/students?status=active",
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
    });
    assert(filteredRes.status === 200, "8. /api/admin/students?status=active returns 200 OK");
    const filteredStudents = filteredRes.body.students || [];
    assert(
        !filteredStudents.some(s => s.roll_number === rollSuspended) &&
        !filteredStudents.some(s => s.roll_number === rollDeleted),
        "9. /api/admin/students?status=active excludes suspended and deleted students"
    );

    // 5. Test Exam Results Anonymization for Deleted Students
    const resultsRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: `/api/admin/results?examId=${encodeURIComponent(examId)}`,
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
    });

    assert(resultsRes.status === 200 && resultsRes.body.success, "10. /api/admin/results returns 200 OK");
    const examResults = resultsRes.body.results || [];
    const deletedStudentResult = examResults.find(r => r.rollNumber === rollDeleted);

    assert(!!deletedStudentResult, "11. Institutional audit retained deleted student attempt scorecard");
    if (deletedStudentResult) {
        assert(
            deletedStudentResult.studentName.includes(`[Deactivated Student - ${rollDeleted}]`),
            `12. Student Name is anonymized as '[Deactivated Student - ${rollDeleted}]'`,
            `Actual: ${deletedStudentResult.studentName}`
        );
        assert(
            deletedStudentResult.email === "[Protected - Deactivated]",
            "13. Email is anonymized as '[Protected - Deactivated]'",
            `Actual: ${deletedStudentResult.email}`
        );
        assert(
            deletedStudentResult.marksObtained !== null && deletedStudentResult.marksObtained !== undefined,
            "14. Score is preserved for institutional accreditation records",
            `Score: ${deletedStudentResult.marksObtained}`
        );
    }

    // 6. Test Exam Monitoring Roster Anonymization for Deleted Students
    const monitorRes = await request({
        hostname: "127.0.0.1",
        port: 3000,
        path: `/api/admin/exams/monitoring?examId=${encodeURIComponent(examId)}`,
        method: "GET",
        headers: { "Authorization": `Bearer ${adminToken}` }
    });

    assert(monitorRes.status === 200 && monitorRes.body.success, "15. /api/admin/exams/monitoring returns 200 OK");
    const candidates = monitorRes.body.candidates || [];
    const deletedCandidate = candidates.find(c => c.rollNumber === rollDeleted);

    assert(!!deletedCandidate, "16. Monitoring roster retained deleted student historical attempt");
    if (deletedCandidate) {
        assert(
            deletedCandidate.studentName.includes(`[Deactivated Student - ${rollDeleted}]`),
            `17. Candidate Name in monitoring is anonymized as '[Deactivated Student - ${rollDeleted}]'`,
            `Actual: ${deletedCandidate.studentName}`
        );
        assert(
            deletedCandidate.email === "[Protected - Deactivated]",
            "18. Candidate Email in monitoring is anonymized as '[Protected - Deactivated]'",
            `Actual: ${deletedCandidate.email}`
        );
    }

    console.log("\n==================================================================");
    console.log(`TOTAL AUDIT CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log("==================================================================");

    if (failed === 0) {
        console.log(">>> ACTIVE EXPORT & DELETION ANONYMIZATION: 100% VERIFIED! <<<");
    } else {
        process.exit(1);
    }
}

runAudit().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});

