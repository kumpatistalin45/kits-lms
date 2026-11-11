/**
 * KITS LMS — 100 CONCURRENT USERS LOAD & PERFORMANCE BENCHMARK
 * Simulates 100 concurrent students executing complete exam lifecycle simultaneously.
 */

const http = require("http");

const BASE_HOST = "127.0.0.1";
const BASE_PORT = 3000;
const CONCURRENT_STUDENTS = 100;
let EXAM_ID = "exam_standard_50mcq";

// Dedicated http.Agent with keepAlive for high connection reuse
const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 150,
    keepAliveMsecs: 30000
});

function request(options, postData) {
    const start = Date.now();
    return new Promise((resolve) => {
        const reqOpts = {
            hostname: BASE_HOST,
            port: BASE_PORT,
            agent: httpAgent,
            ...options
        };

        const req = http.request(reqOpts, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                const duration = Date.now() - start;
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsed,
                    duration
                });
            });
        });

        req.on("error", (err) => {
            const duration = Date.now() - start;
            resolve({
                status: 0,
                error: err.message,
                duration
            });
        });

        if (postData) {
            req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

function calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
}

async function runBenchmark() {
    console.log("===============================================================================");
    console.log("  KITS LMS — 100 CONCURRENT USERS PERFORMANCE & STRESS TEST");
    console.log(`  Target: http://${BASE_HOST}:${BASE_PORT}`);
    console.log(`  Concurrent Virtual Students: ${CONCURRENT_STUDENTS}`);
    console.log(`  Target Examination: ${EXAM_ID} (50 MCQs / 60 Min / 50 Marks)`);
    console.log("===============================================================================\n");

    console.log("--> Phase 0: Provisioning Active 50-MCQ Examination for Benchmark...");
    const adminLog = await request({
        path: "/api/auth/admin-login",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, { username: "IT", password: "INFORMATIONTECHNOLOGY" });

    if (adminLog.status === 200 && adminLog.body.token) {
        const testExId = "exam_bench_" + Date.now();
        const createExRes = await request({
            path: "/api/admin/exams/create",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminLog.body.token}`
            }
        }, {
            id: testExId,
            title: "100-Candidate Performance Benchmark Assessment",
            duration_minutes: 60,
            scheduled_start_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
            status: "published"
        });
        if (createExRes.status === 201 && createExRes.body.exam) {
            EXAM_ID = createExRes.body.exam.id;
            console.log(`  ✓ Benchmark Examination provisioned: ${EXAM_ID}\n`);
        }
    }

    // Phase 1: Provision 100 Students
    console.log("--> Phase 1: Rapid Provisioning 100 Candidate Accounts...");
    const provStart = Date.now();
    const runPrefix = "22U" + Math.floor(10 + Math.random() * 90);
    const students = [];
    for (let i = 1; i <= CONCURRENT_STUDENTS; i++) {
        const pad = String(i).padStart(3, "0");
        const roll = `${runPrefix}${pad}`;
        students.push({
            roll,
            name: `Load Candidate ${pad}`,
            email: `${roll.toLowerCase()}@kits.edu`,
            department: "Information Technology",
            academic_year: "3rd Year B.Tech"
        });
    }

    // Register students concurrently in chunks of 25
    const chunkSize = 25;
    for (let c = 0; c < students.length; c += chunkSize) {
        const slice = students.slice(c, c + chunkSize);
        await Promise.all(slice.map(s => request({
            path: "/api/auth/register-student",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            roll_number: s.roll,
            name: s.name,
            email: s.email,
            department: s.department,
            academic_year: s.academic_year,
            firebase_uid: `uid_${s.roll}`
        })));
    }
    console.log(`  ✓ 100 Students provisioned in ${Date.now() - provStart} ms.\n`);

    // Phase 2: Launch 100 Concurrent Virtual Students
    console.log("--> Phase 2: Launching 100 Concurrent Student Exam Lifecycles simultaneously...");
    console.log("    [Step 1] Fetch Dashboard Assigned Exams");
    console.log("    [Step 2] Start/Acquire Exam Attempt (Single attempt token)");
    console.log("    [Step 3] Real-time Autosave 5 Answers");
    console.log("    [Step 4] Final Evaluation & Submission");
    console.log("    [Step 5] Verify Single-Attempt Retake Lockout");
    console.log("    [Step 6] Retrieve Final Evaluated Scorecard\n");

    const allLatencies = [];
    const operationLatencies = {
        fetchDashboard: [],
        startAttempt: [],
        autosave: [],
        submitExam: [],
        retakeLockout: [],
        fetchScorecard: []
    };

    let totalRequests = 0;
    let successfulOperations = 0;
    let failedOperations = 0;
    const scorecards = [];
    const lockoutConfirmations = [];

    const benchmarkStart = Date.now();

    // Map all 100 students to concurrent async workflows
    const studentTasks = students.map(async (student, idx) => {
        const studentLog = [];

        // 1. Fetch Dashboard Assigned Exams
        const dashRes = await request({
            path: `/api/student/assigned-exams?roll=${student.roll}`,
            method: "GET"
        });
        totalRequests++;
        allLatencies.push(dashRes.duration);
        operationLatencies.fetchDashboard.push(dashRes.duration);
        if (dashRes.status === 200 && dashRes.body.success) {
            successfulOperations++;
        } else {
            failedOperations++;
            studentLog.push(`Dashboard fail: ${dashRes.status}`);
        }

        // 2. Start Exam Attempt
        const startRes = await request({
            path: "/api/exams/start",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: EXAM_ID,
            rollNumber: student.roll,
            studentName: student.name
        });
        totalRequests++;
        allLatencies.push(startRes.duration);
        operationLatencies.startAttempt.push(startRes.duration);

        const attemptId = startRes.body && startRes.body.attemptId;
        if (startRes.status === 200 && startRes.body.success && attemptId) {
            successfulOperations++;
        } else {
            failedOperations++;
            studentLog.push(`Start fail: ${startRes.status}`);
        }

        // 3. Autosave 5 Answers (concurrent per student)
        const sampleAnswers = {
            "1": ["A", "B", "C", "D"][idx % 4],
            "2": ["B", "C", "D", "A"][idx % 4],
            "3": ["C", "D", "A", "B"][idx % 4],
            "4": ["D", "A", "B", "C"][idx % 4],
            "5": ["A", "C", "B", "D"][idx % 4]
        };

        for (const [qNum, opt] of Object.entries(sampleAnswers)) {
            const autoRes = await request({
                path: "/api/exams/save-answer",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            }, {
                attemptId,
                examId: EXAM_ID,
                rollNumber: student.roll,
                questionNumber: Number(qNum),
                selectedOption: opt
            });
            totalRequests++;
            allLatencies.push(autoRes.duration);
            operationLatencies.autosave.push(autoRes.duration);
            if (autoRes.status === 200) {
                successfulOperations++;
            } else {
                failedOperations++;
            }
        }

        // 4. Submit Exam
        const submitRes = await request({
            path: "/api/exams/submit",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: EXAM_ID,
            rollNumber: student.roll,
            studentName: student.name,
            attemptId,
            answers: sampleAnswers,
            autoSubmitted: false
        });
        totalRequests++;
        allLatencies.push(submitRes.duration);
        operationLatencies.submitExam.push(submitRes.duration);
        if (submitRes.status === 200 && submitRes.body.success) {
            successfulOperations++;
            scorecards.push({
                roll: student.roll,
                score: submitRes.body.score,
                percentage: submitRes.body.percentage
            });
        } else {
            failedOperations++;
            studentLog.push(`Submit fail: ${submitRes.status}`);
        }

        // 5. Retake Attempt (Must be strictly blocked with alreadySubmitted: true)
        const retakeRes = await request({
            path: "/api/exams/start",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, {
            examId: EXAM_ID,
            rollNumber: student.roll,
            studentName: student.name
        });
        totalRequests++;
        allLatencies.push(retakeRes.duration);
        operationLatencies.retakeLockout.push(retakeRes.duration);
        if ((retakeRes.status === 409 || retakeRes.status === 200) && retakeRes.body.alreadySubmitted === true) {
            successfulOperations++;
            lockoutConfirmations.push(student.roll);
        } else {
            failedOperations++;
            studentLog.push(`Retake lockout fail: ${JSON.stringify(retakeRes.body)}`);
        }

        // 6. Retrieve Scorecard
        const cardRes = await request({
            path: `/api/exams/result?roll=${student.roll}&examId=${EXAM_ID}`,
            method: "GET"
        });
        totalRequests++;
        allLatencies.push(cardRes.duration);
        operationLatencies.fetchScorecard.push(cardRes.duration);
        if (cardRes.status === 200 && cardRes.body.result) {
            successfulOperations++;
        } else {
            failedOperations++;
            studentLog.push(`Scorecard fail: ${cardRes.status}`);
        }

        return studentLog;
    });

    const results = await Promise.all(studentTasks);
    const benchmarkTotalDuration = Date.now() - benchmarkStart;

    // Process Metrics
    allLatencies.sort((a, b) => a - b);
    const meanLatency = Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);
    const p50Latency = calculatePercentile(allLatencies, 50);
    const p95Latency = calculatePercentile(allLatencies, 95);
    const p99Latency = calculatePercentile(allLatencies, 99);
    const minLatency = allLatencies[0] || 0;
    const maxLatency = allLatencies[allLatencies.length - 1] || 0;
    const throughputRps = Math.round((totalRequests / (benchmarkTotalDuration / 1000)) * 10) / 10;
    const errorRatePct = Math.round((failedOperations / totalRequests) * 1000) / 10;

    // Check for unique scorecards
    const uniqueRolls = new Set(scorecards.map(s => s.roll));
    const zeroDuplicates = (uniqueRolls.size === CONCURRENT_STUDENTS) && (scorecards.length === CONCURRENT_STUDENTS);

    console.log("===============================================================================");
    console.log("                        BENCHMARK PERFORMANCE RESULTS                          ");
    console.log("===============================================================================");
    console.log(`  Concurrent Users Tested     : ${CONCURRENT_STUDENTS} Active Students`);
    console.log(`  Total HTTP Requests         : ${totalRequests}`);
    console.log(`  Successful Operations       : ${successfulOperations}`);
    console.log(`  Failed Operations           : ${failedOperations}`);
    console.log(`  Overall Error Rate          : ${errorRatePct}% (Requirement: 0.0%)`);
    console.log(`  Total Benchmark Elapsed     : ${(benchmarkTotalDuration / 1000).toFixed(2)} seconds`);
    console.log(`  Throughput                  : ${throughputRps} requests/sec`);
    console.log("-------------------------------------------------------------------------------");
    console.log("  LATENCY METRICS (Round-Trip):");
    console.log(`    Min Latency               : ${minLatency} ms`);
    console.log(`    Mean Latency              : ${meanLatency} ms`);
    console.log(`    Median (p50) Latency      : ${p50Latency} ms`);
    console.log(`    95th Percentile (p95)     : ${p95Latency} ms`);
    console.log(`    99th Percentile (p99)     : ${p99Latency} ms`);
    console.log(`    Max Latency               : ${maxLatency} ms`);
    console.log("-------------------------------------------------------------------------------");
    console.log("  OPERATION-SPECIFIC MEAN LATENCIES:");
    for (const [op, times] of Object.entries(operationLatencies)) {
        times.sort((a, b) => a - b);
        const opMean = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        const opP95 = calculatePercentile(times, 95);
        console.log(`    - ${op.padEnd(18)}: Mean ${String(opMean).padStart(3)} ms | p95 ${String(opP95).padStart(3)} ms`);
    }
    console.log("-------------------------------------------------------------------------------");
    console.log("  INTEGRITY & SECURITY AUDIT:");
    console.log(`    - Unique Scorecards Created : ${uniqueRolls.size} / ${CONCURRENT_STUDENTS} (Zero Duplicate Scorecards: ${zeroDuplicates ? 'YES' : 'NO'})`);
    console.log(`    - Single-Attempt Lockouts   : ${lockoutConfirmations.length} / ${CONCURRENT_STUDENTS} (100% Lockout Rejection: ${lockoutConfirmations.length === CONCURRENT_STUDENTS ? 'YES' : 'NO'})`);
    console.log("===============================================================================\n");

    const errors = results.flat();
    if (errors.length > 0) {
        console.error("Student Errors Encountered:");
        errors.slice(0, 10).forEach(e => console.error("  !", e));
    }

    if (failedOperations === 0 && zeroDuplicates && lockoutConfirmations.length === CONCURRENT_STUDENTS) {
        console.log(">>> [BENCHMARK PASSED] 100 CONCURRENT USERS REQUIREMENT FULLY MET (0% ERRORS) <<<");
        httpAgent.destroy();
        process.exit(0);
    } else {
        console.error(">>> [BENCHMARK FAILED] Performance or integrity issues detected. <<<");
        httpAgent.destroy();
        process.exit(1);
    }
}

runBenchmark().catch(err => {
    console.error("Fatal benchmark error:", err);
    httpAgent.destroy();
    process.exit(1);
});

