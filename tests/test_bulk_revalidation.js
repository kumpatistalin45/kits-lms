/**
 * KITS LMS — Automated Bulk Exam Revalidation Verification Suite
 * 
 * Verifies:
 * 1. Authoritative Exam Question & Key Retrieval Endpoint
 * 2. Deterministic Cohort Impact Preview (Randomization Preserved)
 * 3. Strict Admin Confirmation Safety Gate (Count Mismatch Rejection)
 * 4. Atomic Cohort Revalidation Execution & Firestore Persistence
 * 5. Student Original Submission Protection (Answers NEVER altered)
 * 6. Idempotency Enforcement (Duplicate Operation Rejection)
 * 7. Protected Bulk Revalidation Audit History
 */

const path = require("path");
const http = require("http");
const fs = require("fs");

const envPath = path.resolve(__dirname, "..", ".env");
if (typeof process.loadEnvFile === "function" && fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
}

const { getDatabaseAdapter } = require("../database-adapter");
const serverHandler = require("../server");

async function runBulkRevalidationTests() {
    console.log("==================================================================");
    console.log("⚡ STARTING KITS LMS BULK EXAM REVALIDATION VERIFICATION SUITE");
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

    // 1. Adapter & Firestore Connection
    console.log("[TEST GROUP 1] Database Adapter & Firestore Architecture");
    const adapter = getDatabaseAdapter();
    assert(adapter !== null, "FirestoreAdapter instantiated.");
    const health = await adapter.healthCheck();
    assert(health.healthy === true, "Cloud Firestore connected to kits-lms-13053.");

    // 2. Start local HTTP test server
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
    assert(loginRes.ok && Boolean(loginRes.data && loginRes.data.token), "Admin authenticated with JWT.");
    const adminToken = loginRes.data ? loginRes.data.token : "";
    const adminHeaders = {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json"
    };

    // 3. Test Exam Question & Current Key Retrieval
    console.log("\n[TEST GROUP 3] Question & Authoritative Key Retrieval API");
    const testExamId = "exam_1794510147414";
    const questionsRes = await apiFetch(`/api/admin/revalidation/exam-questions?examId=${encodeURIComponent(testExamId)}`, {
        headers: adminHeaders
    });
    assert(questionsRes.ok, "GET /api/admin/revalidation/exam-questions returned HTTP 200.");
    assert(Array.isArray(questionsRes.data.questions) && questionsRes.data.questions.length > 0, `Returned ${questionsRes.data.questions ? questionsRes.data.questions.length : 0} exam questions.`);
    const sampleQ = questionsRes.data.questions ? questionsRes.data.questions[0] : null;
    assert(sampleQ && Boolean(sampleQ.currentKey), `Question 1 has authoritative currentKey: '${sampleQ ? sampleQ.currentKey : ""}'`);

    // 4. Test Deterministic Cohort Impact Preview
    console.log("\n[TEST GROUP 4] Deterministic Cohort Impact Preview");
    const testQNum = 4;
    const currentQ4 = questionsRes.data.questions.find(q => q.question_number === testQNum) || { currentKey: "B" };
    const revisedKey = currentQ4.currentKey === "D" ? "C" : "D";

    const previewRes = await apiFetch("/api/admin/revalidation/bulk-preview", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            examId: testExamId,
            corrections: [{ questionNumber: testQNum, revisedKey: revisedKey }],
            reason: "Automated regression test: correcting Question 4 key."
        })
    });

    assert(previewRes.ok, "POST /api/admin/revalidation/bulk-preview returned HTTP 200.");
    assert(Boolean(previewRes.data.operationId && previewRes.data.operationId.startsWith("BULK-REVAL-")), `Generated unique operationId: ${previewRes.data.operationId}`);
    assert(typeof previewRes.data.totalSubmitted === "number" && previewRes.data.totalSubmitted > 0, `Total submitted attempts detected: ${previewRes.data.totalSubmitted}`);
    assert(Array.isArray(previewRes.data.affectedStudents), "Returned affectedStudents array.");
    console.log(`  Preview Summary: Affected Candidates = ${previewRes.data.affectedCount}, Unaffected = ${previewRes.data.unaffectedCount}`);

    const sampleAffected = previewRes.data.affectedStudents && previewRes.data.affectedStudents.length > 0 ? previewRes.data.affectedStudents[0] : null;
    if (sampleAffected) {
        assert(typeof sampleAffected.previousMarks === "number" && typeof sampleAffected.revisedMarks === "number", `Candidate ${sampleAffected.rollNumber}: Previous=${sampleAffected.previousMarks}, Revised=${sampleAffected.revisedMarks}, Delta=${sampleAffected.delta}`);
        assert(Boolean(sampleAffected.assignedSet), `Candidate assigned set preserved: ${sampleAffected.assignedSet}`);
    }

    const testOperationId = previewRes.data.operationId;
    const targetRolls = (previewRes.data.affectedStudents || []).map(s => s.rollNumber);
    const confirmedCount = targetRolls.length;

    // 5. Test Safety Confirmation Gate (Count Mismatch Rejection)
    console.log("\n[TEST GROUP 5] Admin Safety Confirmation Gate (Mismatched Count Rejection)");
    const mismatchedExecRes = await apiFetch("/api/admin/revalidation/bulk-execute", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            operationId: testOperationId,
            examId: testExamId,
            corrections: [{ questionNumber: testQNum, revisedKey: revisedKey }],
            reason: "Automated regression test",
            confirmedCount: confirmedCount + 99, // Intentional mismatch
            selectedRolls: targetRolls
        })
    });

    assert(mismatchedExecRes.status === 400, `Rejected mismatched confirmedCount with HTTP 400 (Received: ${mismatchedExecRes.status}).`);
    assert(mismatchedExecRes.data && mismatchedExecRes.data.error.includes("Safety confirmation mismatch"), `Error message explains safety mismatch: "${mismatchedExecRes.data ? mismatchedExecRes.data.error : ""}"`);

    // 6. Test Atomic Cohort Execution & Firestore Commit
    console.log("\n[TEST GROUP 6] Atomic Cohort Execution & Firestore Update");
    
    // Capture pre-execution student attempt state for answer preservation check
    const checkRoll = targetRolls.length > 0 ? targetRolls[0] : "24JR1A1226";
    const preAttempt = await adapter.getAttempt(testExamId, checkRoll);
    const preAnswersJson = preAttempt ? JSON.stringify(preAttempt.answers) : "";

    const validExecRes = await apiFetch("/api/admin/revalidation/bulk-execute", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            operationId: testOperationId,
            examId: testExamId,
            corrections: [{ questionNumber: testQNum, revisedKey: revisedKey }],
            reason: "Automated regression test: faculty verified key correction.",
            confirmedCount: confirmedCount,
            selectedRolls: targetRolls
        })
    });

    assert(validExecRes.ok, `POST /api/admin/revalidation/bulk-execute executed successfully (HTTP ${validExecRes.status}).`);
    assert(validExecRes.data && validExecRes.data.status === "COMPLETED", "Execution status marked as COMPLETED.");
    assert(validExecRes.data && validExecRes.data.updatedCount === confirmedCount, `All ${confirmedCount} target candidate records updated.`);

    // 7. Test Student Original Submission Protection (Answers strictly unchanged)
    console.log("\n[TEST GROUP 7] Student Original Response Preservation Verification");
    const postAttempt = await adapter.getAttempt(testExamId, checkRoll);
    const postAnswersJson = postAttempt ? JSON.stringify(postAttempt.answers) : "";
    assert(preAnswersJson === postAnswersJson, `Original student responses for ${checkRoll} remain 100% IDENTICAL and unmodified.`);

    // 8. Test Idempotency Guard (Duplicate Operation ID Rejection)
    console.log("\n[TEST GROUP 8] Idempotency Guard (Repeat Execution Rejection)");
    const repeatExecRes = await apiFetch("/api/admin/revalidation/bulk-execute", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
            operationId: testOperationId, // Reusing completed operationId
            examId: testExamId,
            corrections: [{ questionNumber: testQNum, revisedKey: revisedKey }],
            reason: "Duplicate submission check",
            confirmedCount: confirmedCount,
            selectedRolls: targetRolls
        })
    });

    assert(repeatExecRes.status === 409, `Duplicate execution rejected with HTTP 409 Conflict (Received: ${repeatExecRes.status}).`);
    assert(repeatExecRes.data && repeatExecRes.data.alreadyProcessed === true, "Response confirmed alreadyProcessed: true.");

    // 9. Test Bulk Revalidation Audit History
    console.log("\n[TEST GROUP 9] Protected Revalidation Audit History Retrieval");
    const historyRes = await apiFetch(`/api/admin/revalidation/bulk-history?examId=${encodeURIComponent(testExamId)}`, {
        headers: adminHeaders
    });
    assert(historyRes.ok, "GET /api/admin/revalidation/bulk-history returned HTTP 200.");
    assert(Array.isArray(historyRes.data.operations), "Returned operations array from Firestore.");
    const recordedOp = historyRes.data.operations.find(o => o.operationId === testOperationId);
    assert(Boolean(recordedOp), `Operation '${testOperationId}' verified in Firestore 'revalidation_bulk_operations' audit collection.`);

    // Teardown
    server.close();

    console.log("\n==================================================================");
    console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log("==================================================================");

    if (failedCount > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runBulkRevalidationTests().catch(err => {
    console.error("Test execution encountered an unhandled error:", err);
    process.exit(1);
});

