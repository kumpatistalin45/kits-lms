const { Readable, Writable } = require("stream");
const appHandler = require("../server.js");

function request(path, method = "GET", body = null, headers = {}) {
    return new Promise(async (resolve, reject) => {
        try {
            const bodyStr = body ? (typeof body === "string" ? body : JSON.stringify(body)) : "";
            const req = new Readable({
                read() {
                    if (bodyStr) {
                        this.push(bodyStr);
                    }
                    this.push(null);
                }
            });
            req.method = method;
            req.url = path;
            req.socket = { remoteAddress: "127.0.0.1" };
            req.connection = req.socket;
            const normalizedHeaders = {
                "host": "localhost:3000",
                "content-type": "application/json"
            };
            if (headers) {
                for (const [k, v] of Object.entries(headers)) {
                    normalizedHeaders[k.toLowerCase()] = v;
                }
            }
            req.headers = normalizedHeaders;
            if (bodyStr) {
                req.headers["content-length"] = Buffer.byteLength(bodyStr);
            }

            let responseData = "";
            let statusCode = 200;
            const responseHeaders = {};

            const res = new Writable({
                write(chunk, encoding, callback) {
                    responseData += chunk.toString();
                    callback();
                }
            });
            res.setHeader = (k, v) => { responseHeaders[k.toLowerCase()] = v; };
            res.getHeader = (k) => responseHeaders[k.toLowerCase()];
            res.writeHead = (code, hdrs) => {
                statusCode = code;
                if (hdrs) {
                    for (const k in hdrs) {
                        responseHeaders[k.toLowerCase()] = hdrs[k];
                    }
                }
            };
            res.end = (chunk) => {
                if (chunk) responseData += chunk.toString();
                let parsed = null;
                try { parsed = JSON.parse(responseData); } catch (_) { parsed = responseData; }
                resolve({ status: statusCode, headers: responseHeaders, body: parsed });
            };

            await appHandler(req, res);
        } catch (err) {
            reject(err);
        }
    });
}

async function runTests() {
    console.log("==================================================================");
    console.log("  KITS LMS — FULL LOCAL REGRESSION & RANDOMIZATION TEST SUITE");
    console.log("==================================================================\n");

    let passed = 0;
    let total = 0;

    function assert(cond, name, details = "") {
        total++;
        if (cond) {
            console.log(`  [PASS] ${name}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${name}`);
            if (details) console.error(`         Details: ${details}`);
        }
    }

    // 1. Health & Server Time
    console.log("--> 1. Health & System Time");
    const health = await request("/api/health");
    assert(health.status === 200 && health.body.status === "UP", "/api/health returns HTTP 200 UP");

    const time = await request("/api/server-time");
    assert(time.status === 200 && time.body.ist, "/api/server-time returns synchronized IST time");

    // 2. Admin Login & Session
    console.log("\n--> 2. Admin Authentication");
    const adminLogin = await request("/api/auth/admin-login", "POST", {
        username: "IT",
        password: "INFORMATIONTECHNOLOGY"
    });
    const adminToken = adminLogin.body && adminLogin.body.token;
    assert(adminLogin.status === 200 && Boolean(adminToken), "Admin login returns token");

    const adminSession = await request("/api/auth/verify-session", "GET", null, {
        "Authorization": `Bearer ${adminToken}`
    });
    assert(adminSession.status === 200 && adminSession.body.valid === true, "Admin session verification valid");

    // 3. Roll Number Uniqueness & Duplicate Rejection
    console.log("\n--> 3. Roll Number Uniqueness & Concurrency Protection");
    // Test 3A: Registering with existing legitimate roll 24JR5A1207 must fail with 409
    const dupRes = await request("/api/auth/register-student", "POST", {
        name: "Duplicate Candidate",
        roll: "24JR5A1207",
        email: "other@kits.edu",
        department: "Information Technology"
    });
    assert(dupRes.status === 409 && dupRes.body.error === "Student with this Roll Number is already registered.",
        "Existing roll number registration rejected with HTTP 409: 'Student with this Roll Number is already registered.'",
        JSON.stringify(dupRes.body)
    );

    // Test 3B: Case and whitespace normalization check (e.g. " 24jr5a1207 ")
    const dupNormRes = await request("/api/auth/register-student", "POST", {
        name: "Whitespace Candidate",
        roll: " 24jr5a1207 ",
        email: "whitespace@kits.edu",
        department: "Information Technology"
    });
    assert(dupNormRes.status === 409 && dupNormRes.body.error === "Student with this Roll Number is already registered.",
        "Normalized roll number (trimmed & uppercased) rejected duplicate with HTTP 409",
        JSON.stringify(dupNormRes.body)
    );

    // Test 3C: Simultaneous duplicate registrations with identical roll
    const testRollSimul = "24SIMUL" + Date.now().toString().slice(-4);
    const [p1, p2] = await Promise.all([
        request("/api/auth/register-student", "POST", {
            name: "Candidate A",
            roll: testRollSimul,
            email: `candidateA_${testRollSimul}@kits.edu`,
            department: "Information Technology"
        }),
        request("/api/auth/register-student", "POST", {
            name: "Candidate B",
            roll: testRollSimul,
            email: `candidateB_${testRollSimul}@kits.edu`,
            department: "Information Technology"
        })
    ]);

    const statuses = [p1.status, p2.status].sort();
    assert(statuses[0] === 200 || statuses[0] === 201, "One simultaneous registration succeeds (200/201)");
    assert(statuses[1] === 409, "Second simultaneous registration is rejected with HTTP 409");

    // Clean up test roll from memory/DB
    const registeredStudentRoll = testRollSimul;

    // 4. 10 Randomized Sets Allocation & Attempt Integrity
    console.log("\n--> 4. 10 Randomized Sets Allocation & Student Attempt Lifecycle");
    // Create an active exam with start time in the current window
    const nowTs = Date.now();
    const createExamRes = await request("/api/admin/exams/create", "POST", {
        title: "Regression Active Exam 50 MCQs " + nowTs,
        description: "Test Exam for 10 Sets Randomization",
        duration_minutes: 60,
        scheduled_start_at: new Date(nowTs - 60 * 1000).toISOString(),
        status: "published"
    }, {
        "Authorization": `Bearer ${adminToken}`
    });
    assert(createExamRes.status === 201 && createExamRes.body.exam, "Active test examination created for regression window");
    const activeExam = createExamRes.body.exam;

    // Accept terms
    const acceptTerms = await request("/api/exams/accept-terms", "POST", {
        examId: activeExam.id,
        rollNumber: registeredStudentRoll,
        studentName: "Test Student " + registeredStudentRoll
    });
    assert(acceptTerms.status === 200 && acceptTerms.body.termsAccepted, "Candidate accepts exam terms");

    // Start Exam -> Allocate 1 of 10 Sets
    const start1 = await request("/api/exams/start", "POST", {
        examId: activeExam.id,
        rollNumber: registeredStudentRoll,
        studentName: "Test Student " + registeredStudentRoll
    });
    assert(start1.status === 200, "Candidate starts exam successfully");
    const assignedSetNum = start1.body.setNumber;
    const assignedSetName = start1.body.setName;
    assert(assignedSetNum >= 1 && assignedSetNum <= 10, `Candidate allocated valid Set (Set ${assignedSetNum}: ${assignedSetName})`);
    assert(start1.body.questions && start1.body.questions.length === 50, "Sanitized exam delivers exactly 50 questions");

    // Zero answer keys exposed
    const leakedKeys = start1.body.questions.some(q => q.correct_answer || q.correct_answers || q.answer);
    assert(!leakedKeys, "Zero answer keys or evaluation secrets exposed to the frontend");

    // Refresh / Resume attempt -> Strict Set Retention Check
    const startResume = await request("/api/exams/start", "POST", {
        examId: activeExam.id,
        rollNumber: registeredStudentRoll,
        studentName: "Test Student " + registeredStudentRoll
    });
    assert(startResume.status === 200 && startResume.body.setNumber === assignedSetNum,
        `Reconnecting/resuming attempt strictly retains assigned Set ${assignedSetNum} (Never reshuffled)`
    );

    // 5. Autosave & Evaluation against Assigned Set
    console.log("\n--> 5. Autosave & Set-Specific Server Evaluation");
    const saveAns = await request("/api/exams/save-answer", "POST", {
        examId: activeExam.id,
        rollNumber: registeredStudentRoll,
        questionNumber: 1,
        selectedOption: "B"
    });
    assert(saveAns.status === 200 && saveAns.body.success, "Autosave answer for question 1 succeeds");

    const submitExam = await request("/api/exams/submit", "POST", {
        examId: activeExam.id,
        rollNumber: registeredStudentRoll,
        studentName: "Test Student " + registeredStudentRoll,
        answers: { "1": "B" },
        autoSubmitted: false
    });
    assert(submitExam.status === 200 && submitExam.body.result, "Final submission evaluated on server");
    const resultObj = submitExam.body.result;
    assert(resultObj.setNumber === assignedSetNum, `Scorecard accurately references candidate's assigned Set ${assignedSetNum}`);
    assert(resultObj.totalMarks === 50 && resultObj.totalQuestions === 50, "Total marks and question count evaluated to 50");

    // Retake lockout check
    const retakeRes = await request("/api/exams/start", "POST", {
        examId: activeExam.id,
        rollNumber: registeredStudentRoll
    });
    assert(retakeRes.status === 409 && retakeRes.body.alreadySubmitted === true, "Retake strictly blocked with HTTP 409 alreadySubmitted");

    // Scorecard retrieval check
    const scoreRes = await request(`/api/exams/result?examId=${activeExam.id}&roll=${registeredStudentRoll}`);
    assert(scoreRes.status === 200 && scoreRes.body.result && scoreRes.body.result.studentRoll === registeredStudentRoll,
        "Candidate retrieves official evaluated scorecard"
    );

    console.log("\n==================================================================");
    console.log(`  LOCAL REGRESSION SUITE: ${passed} / ${total} CHECKS PASSED`);
    console.log("==================================================================");

    if (passed === total) {
        console.log("  >>> ALL LOCAL CHECKS PASSED SUCCESSFULLY <<<\n");
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
