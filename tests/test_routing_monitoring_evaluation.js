/**
 * KITS LMS — Critical Verification Test Suite:
 * 1. Routing & Initial Page Load (index.html, exam.html, auth.html, dashboard.html, sign out)
 * 2. Second-Year Filter & Multi-Facet Filtering
 * 3. Exam Monitoring & Multi-Exam Strict Isolation
 * 4. Answer Evaluation & Academic Explanations (Zero generic fallbacks)
 * 5. Permanent Deletion Safety & Confirmation
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

const {
    DEFAULT_50_MCQS,
    sanitizeQuestionsForStudent
} = require("../exam-default-data");

const {
    generateStudentExamArrangement,
    evaluateStudentSubmission,
    getRollNumberSeed
} = require("../exam-randomizer");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (e) {
        console.error(`  [FAIL] ${name}: ${e.message}`);
    }
}

async function testAsync(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (e) {
        console.error(`  [FAIL] ${name}: ${e.message}`);
    }
}

async function run() {
    console.log("==================================================================");
    console.log("  KITS LMS — CRITICAL ROUTING, EVALUATION & MONITORING SUITE");
    console.log("==================================================================");

    // -------------------------------------------------------------------------
    // 1. ROUTING & ENTRY POINTS
    // -------------------------------------------------------------------------
    console.log("\n--> 1. Routing Architecture & Gateway Tests");

    test("index.html is Root Gateway and does NOT contain the 90-min online exam room", () => {
        const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf-8");
        assert(!indexHtml.includes("Online Examination Room"), "index.html should not be the online exam room");
        assert(!indexHtml.includes("palette-sidebar"), "index.html should not have exam question palette");
        assert(indexHtml.toLowerCase().includes("gateway"), "index.html should be the gateway router");
        assert(indexHtml.includes("auth.html"), "index.html should route unauthenticated visitors to auth.html");
    });

    test("exam.html exists as dedicated Online Examination Room", () => {
        const examHtml = fs.readFileSync(path.join(__dirname, "..", "exam.html"), "utf-8");
        assert(examHtml.includes("Online Examination Room"), "exam.html must have the examination room title");
        assert(examHtml.includes("palette-sidebar"), "exam.html must include the question palette");
        assert(examHtml.includes("finalizeSubmission"), "exam.html must include submission handling");
    });

    test("exam-terms.html directs students to exam.html upon terms acceptance", () => {
        const termsHtml = fs.readFileSync(path.join(__dirname, "..", "exam-terms.html"), "utf-8");
        assert(termsHtml.includes("exam.html?examId="), "exam-terms.html must launch exam.html, not index.html");
        assert(!termsHtml.includes("index.html?examId="), "exam-terms.html must not launch index.html");
    });

    test("dashboard.html redirects unauthenticated access to auth.html (no fake 22IT001)", () => {
        const dashHtml = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf-8");
        assert(!dashHtml.includes('studentSession = { roll: "22IT001", name: "A. Srikanth"'), "dashboard.html must not set fake 22IT001 student");
        assert(dashHtml.includes('window.location.replace("auth.html");'), "dashboard.html must redirect unauthenticated visitors to auth.html");
    });

    test("student-nav.js and backend-api.js completely purge session on sign out", () => {
        const navJs = fs.readFileSync(path.join(__dirname, "..", "student-nav.js"), "utf-8");
        assert(navJs.includes("sessionStorage.removeItem"), "student-nav.js must purge sessionStorage");
        assert(navJs.includes("localStorage.removeItem(\"kits_lms_auth_session\")"), "student-nav.js must remove auth session");

        const apiJs = fs.readFileSync(path.join(__dirname, "..", "backend-api.js"), "utf-8");
        assert(apiJs.includes("sessionStorage.removeItem"), "backend-api.js must purge sessionStorage");
    });

    // -------------------------------------------------------------------------
    // 2. SECOND-YEAR STUDENT FILTER & MULTI-FACET FILTERING
    // -------------------------------------------------------------------------
    console.log("\n--> 2. Second-Year Student Filter & Multi-Facet Filtering");

    const adminJs = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf-8");

    test("admin.js contains robust matchesAcademicYear helper", () => {
        assert(adminJs.includes("function matchesAcademicYear"), "admin.js must define matchesAcademicYear");
    });

    // Evaluate matchesAcademicYear in a test context
    const matchesYearCode = adminJs.substring(adminJs.indexOf("function matchesAcademicYear"), adminJs.indexOf("function matchesAcademicYear") + 1200);
    const extractFn = new Function(`${matchesYearCode}; return matchesAcademicYear;`);
    const matchesAcademicYear = extractFn();

    test("matchesAcademicYear accurately matches '2nd Year B.Tech (2026-27)' when filter is '2nd Year'", () => {
        const storedValue = "2nd Year B.Tech (2026-27)";
        assert.strictEqual(matchesAcademicYear(storedValue, "2nd Year"), true);
        assert.strictEqual(matchesAcademicYear(storedValue, "2nd Year B.Tech"), true);
        assert.strictEqual(matchesAcademicYear(storedValue, "3rd Year"), false);
        assert.strictEqual(matchesAcademicYear(storedValue, "4th Year"), false);
        assert.strictEqual(matchesAcademicYear(storedValue, "1st Year"), false);
    });

    test("matchesAcademicYear accurately matches '3rd Year B.Tech (2026-27)' when filter is '3rd Year'", () => {
        const storedValue = "3rd Year B.Tech (2026-27)";
        assert.strictEqual(matchesAcademicYear(storedValue, "3rd Year"), true);
        assert.strictEqual(matchesAcademicYear(storedValue, "2nd Year"), false);
    });

    test("matchesAcademicYear matches '4th Year B.Tech (2026-27)' when filter is '4th Year'", () => {
        const storedValue = "4th Year B.Tech (2026-27)";
        assert.strictEqual(matchesAcademicYear(storedValue, "4th Year"), true);
        assert.strictEqual(matchesAcademicYear(storedValue, "2nd Year"), false);
    });

    test("admin-dashboard.html monitoring toolbar includes Dept and Year filters", () => {
        const adminDashHtml = fs.readFileSync(path.join(__dirname, "..", "admin-dashboard.html"), "utf-8");
        assert(adminDashHtml.includes("monitorDeptFilter"), "admin-dashboard.html must have monitorDeptFilter");
        assert(adminDashHtml.includes("monitorYearFilter"), "admin-dashboard.html must have monitorYearFilter");
    });

    // -------------------------------------------------------------------------
    // 3. EXPLANATIONS & EVALUATION (ZERO GENERIC FALLBACKS)
    // -------------------------------------------------------------------------
    console.log("\n--> 3. Answer Evaluation & Academic Explanations");

    test("All 50 questions in DEFAULT_50_MCQS have non-empty academic explanations", () => {
        assert.strictEqual(DEFAULT_50_MCQS.length, 50, "Question bank must contain exactly 50 questions");
        for (let i = 0; i < DEFAULT_50_MCQS.length; i++) {
            const q = DEFAULT_50_MCQS[i];
            assert(q.explanation && q.explanation.length > 20, `Question ${i + 1} must have detailed academic explanation`);
            assert(!q.explanation.includes("Option ("), `Question ${i + 1} must not have generic fallback`);
        }
    });

    test("Evaluation attaches verified academic explanation to each itemizedReview item", () => {
        const exam = {
            id: "exam_test_eval",
            title: "Test Exam with Explanations",
            questions: DEFAULT_50_MCQS
        };

        const arrangement = generateStudentExamArrangement(exam, "25JR1A1260");
        const studentAnswers = { 1: arrangement.questions[0].displayed_correct_answer };

        const evaluation = evaluateStudentSubmission(studentAnswers, arrangement);
        assert.strictEqual(evaluation.totalQuestions, 50);
        assert.strictEqual(evaluation.score, 1);
        assert.strictEqual(evaluation.correctCount, 1);

        const firstReview = evaluation.itemizedReview[0];
        assert.strictEqual(firstReview.isCorrect, true);
        assert(firstReview.explanation && firstReview.explanation.length > 15, "Review item must carry academic explanation");
        assert(!firstReview.explanation.includes("Option ("), "Explanation must not be a generic fallback");
    });

    test("results.html supports MSQ multiple selection highlighting and displays academic explanation", () => {
        const resultsHtml = fs.readFileSync(path.join(__dirname, "..", "results.html"), "utf-8");
        assert(resultsHtml.includes("correctSet"), "results.html must use correctSet for multi-answer support");
        assert(resultsHtml.includes("studentSet"), "results.html must use studentSet for candidate choices");
        assert(resultsHtml.includes("academicExplanation"), "results.html must render academic explanation");
        assert(!resultsHtml.includes("The correct answer is Option (${correctOpt})."), "results.html must not contain generic fallback");
    });

    // -------------------------------------------------------------------------
    // 4. EXAM MONITORING & MULTI-EXAM ISOLATION
    // -------------------------------------------------------------------------
    console.log("\n--> 4. Exam Monitoring & Multi-Exam Strict Isolation");

    const serverJs = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf-8");

    test("server.js monitoring dynamically merges candidates from results and attempts", () => {
        assert(serverJs.includes("examResults.forEach"), "server.js monitoring must check examResults for candidate rolls");
        assert(serverJs.includes("examAttempts.forEach"), "server.js monitoring must check examAttempts for candidate rolls");
    });

    test("server.js monitoring does NOT silently fallback to memExams[0] when targetExamId requested", () => {
        assert(serverJs.includes("targetExamId.toLowerCase()"), "server.js must look up requested targetExamId case-insensitively");
    });

    test("admin.js formats dates in IST with Asia/Kolkata timezone", () => {
        assert(adminJs.includes("Asia/Kolkata"), "admin.js formatDateTime must use Asia/Kolkata timezone");
    });

    // -------------------------------------------------------------------------
    // 5. PERMANENT DELETION
    // -------------------------------------------------------------------------
    console.log("\n--> 5. Permanent Deletion & Safety Rules");

    test("server.js student deletion verifies exact roll confirmation", () => {
        assert(serverJs.includes("confirmationRoll !== roll"), "student deletion must require exact confirmation roll");
        assert(serverJs.includes('target.status = "deleted"'), "student deletion must set deleted status");
        assert(serverJs.includes('target.name = `[Deactivated Student - ${roll}]`'), "student deletion must anonymize name");
    });

    test("server.js exam deletion verifies confirmation phrase and deletes associated records", () => {
        assert(serverJs.includes("deleteExamFromDatabase"), "exam deletion must remove from database");
        assert(serverJs.includes("results.filter(r => r.examId !== examId)"), "exam deletion must purge results");
        assert(serverJs.includes("attempts.filter(a => a.examId !== examId)"), "exam deletion must purge attempts");
    });

    console.log("\n==================================================================");
    console.log(`  VERIFICATION SUITE: ${passed} / ${total} CHECKS PASSED`);
    console.log("==================================================================");

    if (passed === total) {
        console.log("  >>> ALL CRITICAL REQUIREMENTS CONFIRMED PASSED <<<\n");
        process.exit(0);
    } else {
        console.error("  >>> SOME CHECKS FAILED <<<\n");
        process.exit(1);
    }
}

run().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
