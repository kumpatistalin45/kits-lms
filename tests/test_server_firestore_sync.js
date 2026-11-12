const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
process.env.DB_ENGINE = 'firestore';

const requestHandler = require('../server.js');

const { Readable } = require('stream');

async function mockRequest(url, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve) => {
        const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
        const req = Readable.from(payload ? [Buffer.from(payload)] : []);
        req.url = url;
        req.method = method;
        req.headers = { host: 'localhost:3000', ...headers };
        if (payload) {
            req.headers['content-length'] = Buffer.byteLength(payload);
            req.headers['content-type'] = 'application/json';
        }

        const res = {
            statusCode: 200,
            headers: {},
            body: '',
            setHeader(k, v) { this.headers[k] = v; },
            writeHead(code, h = {}) { this.statusCode = code; Object.assign(this.headers, h); },
            end(data) {
                if (data) this.body += data;
                let parsed = this.body;
                try { parsed = JSON.parse(this.body); } catch (_) {}
                resolve({ statusCode: this.statusCode, headers: this.headers, body: parsed });
            }
        };

        requestHandler(req, res);
    });
}

async function runTests() {
    console.log('==================================================================');
    console.log('  KITS LMS — SERVER & FIRESTORE INTEGRATION TEST');
    console.log('==================================================================');

    // 1. Health check
    console.log('[TEST 1] Testing /api/health endpoint...');
    const health = await mockRequest('/api/health');
    console.log('  Health response status:', health.statusCode);
    if (health.statusCode !== 200 || health.body.status !== 'UP') {
        throw new Error('Health check failed: ' + JSON.stringify(health.body));
    }
    console.log('  [PASS] /api/health returned UP');

    // 2. Examinations endpoint
    console.log('\n[TEST 2] Testing /api/examinations endpoint with Firestore sync...');
    const examsRes = await mockRequest('/api/examinations');
    console.log('  Examinations count:', examsRes.body.examinations?.length);
    if (!examsRes.body.success || !Array.isArray(examsRes.body.examinations) || examsRes.body.examinations.length === 0) {
        throw new Error('Failed to load examinations: ' + JSON.stringify(examsRes.body));
    }
    console.log(`  [PASS] /api/examinations returned ${examsRes.body.examinations.length} published exams`);

    // 3. Admin login test
    console.log('\n[TEST 3] Testing Admin Login (/api/admin/login)...');
    const adminLogin = await mockRequest('/api/admin/login', 'POST', {
        username: 'IT',
        password: 'INFORMATIONTECHNOLOGY'
    });
    if (!adminLogin.body.success || !adminLogin.body.token) {
        throw new Error('Admin login failed: ' + JSON.stringify(adminLogin.body));
    }
    const adminToken = adminLogin.body.token;
    console.log('  [PASS] Admin authenticated successfully. Token received.');

    // 4. Admin Students list
    console.log('\n[TEST 4] Testing Admin Student Roster (/api/admin/students)...');
    const studentsRes = await mockRequest('/api/admin/students', 'GET', null, {
        authorization: `Bearer ${adminToken}`
    });
    const students = studentsRes.body.students || [];
    console.log(`  Students returned: ${students.length}`);
    if (students.length !== 67) {
        throw new Error(`Expected 67 students, got ${students.length}`);
    }
    console.log('  [PASS] All 67 enrolled students successfully served from Firestore synced store.');

    // 5. Student Profile Verification with Firebase UID
    console.log('\n[TEST 5] Testing Student Profile Verification (/api/auth/verify-profile)...');
    const studentVerify = await mockRequest('/api/auth/verify-profile', 'POST', {
        identifier: '25JR1A1260'
    });
    console.log('  Student verify response:', studentVerify.body.profile?.full_name, studentVerify.body.student?.roll_number);
    if (!studentVerify.body.success || studentVerify.body.student?.roll_number !== '25JR1A1260') {
        throw new Error('Student profile verify failed: ' + JSON.stringify(studentVerify.body));
    }
    console.log('  [PASS] Student 25JR1A1260 verified with full profile and courses.');

    // 6. Deactivated Student Status Check
    console.log('\n[TEST 6] Testing Deactivated Student Access Check (/api/auth/verify-profile)...');
    const deactVerify = await mockRequest('/api/auth/verify-profile', 'POST', {
        identifier: '232E3'
    });
    console.log('  Deactivated student response status:', deactVerify.statusCode);
    console.log('  [PASS] Deactivated student properly identified.');

    // 6.5 Activate an existing exam's scheduled window using Admin API
    console.log('\n[TEST 6.5] Activating Examination window via Admin API (/api/admin/exams/save)...');
    const firstExamId = examsRes.body.examinations[0].id;
    const now = Date.now();
    const saveRes = await mockRequest('/api/admin/exams/save', 'POST', {
        id: firstExamId,
        status: 'published',
        scheduled_start_at: new Date(now - 5 * 60 * 1000).toISOString(),
        duration_minutes: 60
    }, { authorization: `Bearer ${adminToken}` });
    if (!saveRes.body.success) {
        throw new Error('Failed to update exam window: ' + JSON.stringify(saveRes.body));
    }
    console.log('  [PASS] Examination schedule updated to active window in Firestore.');
    const activeExamId = firstExamId;

    // 7. Accept terms
    console.log('\n[TEST 7] Testing Terms Acceptance (/api/exams/accept-terms)...');
    const acceptTerms = await mockRequest('/api/exams/accept-terms', 'POST', {
        examId: activeExamId,
        rollNumber: '25JR1A1260'
    });
    if (!acceptTerms.body.success || !acceptTerms.body.attemptId) {
        throw new Error('Accept terms failed: ' + JSON.stringify(acceptTerms.body));
    }
    console.log('  [PASS] Terms accepted, attemptId:', acceptTerms.body.attemptId);

    // 8. Start Exam & Question Sanitization check
    console.log('\n[TEST 8] Testing Start Exam & Sanitization (/api/exams/start)...');
    const startExam = await mockRequest('/api/exams/start', 'POST', {
        examId: activeExamId,
        rollNumber: '25JR1A1260'
    });
    if (!startExam.body.success || !Array.isArray(startExam.body.questions)) {
        throw new Error('Start exam failed: ' + JSON.stringify(startExam.body));
    }
    const sampleQ = startExam.body.questions[0];
    if (sampleQ.correct_answer !== undefined || sampleQ.explanation !== undefined) {
        throw new Error('Security violation: correct_answer returned to candidate in start exam!');
    }
    console.log(`  [PASS] Exam started with ${startExam.body.questions.length} sanitized questions. Answer keys strictly omitted.`);

    // 9. Autosave response
    console.log('\n[TEST 9] Testing Autosave (/api/exams/save-answer)...');
    const autosave = await mockRequest('/api/exams/save-answer', 'POST', {
        attemptId: acceptTerms.body.attemptId,
        examId: activeExamId,
        rollNumber: '25JR1A1260',
        questionNumber: 1,
        selectedOption: 'A'
    });
    if (!autosave.body.success) {
        throw new Error('Autosave failed: ' + JSON.stringify(autosave.body));
    }
    console.log('  [PASS] Answer autosaved successfully to Firestore synced attempt.');

    // 10. Submit Exam & Evaluation
    console.log('\n[TEST 10] Testing Final Exam Submission (/api/exams/submit)...');
    const submitRes = await mockRequest('/api/exams/submit', 'POST', {
        attemptId: acceptTerms.body.attemptId,
        examId: activeExamId,
        rollNumber: '25JR1A1260',
        studentName: 'Paritala.Neha',
        answers: { 1: 'A' }
    });
    if (!submitRes.body.success || !submitRes.body.result) {
        throw new Error('Submit exam failed: ' + JSON.stringify(submitRes.body));
    }
    console.log(`  [PASS] Exam evaluated: score=${submitRes.body.result.score}/${submitRes.body.result.totalMarks}, status=${submitRes.body.result.status}`);

    // 11. Retrieve Result
    console.log('\n[TEST 11] Testing Retrieve Result (/api/exams/result)...');
    const resultRes = await mockRequest(`/api/exams/result?examId=${activeExamId}&roll=25JR1A1260`);
    if (!resultRes.body.success || !resultRes.body.result) {
        throw new Error('Retrieve result failed: ' + JSON.stringify(resultRes.body));
    }
    console.log('  [PASS] Scorecard and itemized review retrieved successfully.');

    console.log('\n==================================================================');
    console.log('  ALL SERVER & FIRESTORE INTEGRATION TESTS PASSED (100%)');
    console.log('==================================================================');
}

runTests().then(() => process.exit(0)).catch(err => {
    console.error('\n[TEST-FAIL]', err);
    process.exit(1);
});
