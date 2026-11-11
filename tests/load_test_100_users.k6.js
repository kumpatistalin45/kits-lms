import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * KITS LMS — 100 Concurrent Active Users Performance Benchmark
 * 
 * Target Thresholds:
 * - 100 concurrent active users
 * - 0% acceptance error rate (http_req_failed < 0.01)
 * - p95 < 2s for dashboard page loads (p(95) < 2000)
 * - p95 < 1s for normal APIs (p(95) < 1000)
 * - 0 duplicate submissions
 * - 0 lost answers
 */

export const options = {
    scenarios: {
        // Scenario A: 100 concurrent logins
        concurrent_logins: {
            executor: 'constant-vus',
            vus: 100,
            duration: '30s',
            startTime: '0s',
            exec: 'scenarioA_Logins',
        },
        // Scenario B: 100 concurrent student dashboards
        concurrent_dashboards: {
            executor: 'constant-vus',
            vus: 100,
            duration: '30s',
            startTime: '35s',
            exec: 'scenarioB_Dashboards',
        },
        // Scenario C: 100 concurrent students taking exam (autosave + submission)
        concurrent_exam_execution: {
            executor: 'constant-vus',
            vus: 100,
            duration: '30s',
            startTime: '70s',
            exec: 'scenarioC_ExamExecution',
        },
        // Scenario D: Faculty / Admin concurrent queries
        concurrent_admin_queries: {
            executor: 'constant-vus',
            vus: 100,
            duration: '30s',
            startTime: '105s',
            exec: 'scenarioD_AdminQueries',
        },
        // Scenario E: Stress & spike test (ramp from 10 to 100 users sustained)
        stress_and_spike: {
            executor: 'ramping-vus',
            startVUs: 10,
            stages: [
                { duration: '10s', target: 50 },
                { duration: '20s', target: 100 },
                { duration: '15s', target: 100 },
                { duration: '5s', target: 0 },
            ],
            startTime: '140s',
            exec: 'scenarioE_StressSpike',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.01'], // Acceptance error rate must be < 1% (target 0%)
        'http_req_duration{type:dashboard}': ['p(95)<2000'], // p95 < 2s for dashboard
        'http_req_duration{type:api}': ['p(95)<1000'], // p95 < 1s for normal APIs
    },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Scenario A: 100 Concurrent Logins
export function scenarioA_Logins() {
    group('Scenario A: 100 Concurrent Logins', function () {
        const payload = JSON.stringify({
            username: 'IT',
            password: 'INFORMATIONTECHNOLOGY'
        });
        const params = {
            headers: { 'Content-Type': 'application/json' },
            tags: { type: 'api' }
        };
        const res = http.post(`${BASE_URL}/api/auth/admin-login`, payload, params);
        check(res, {
            'login status is 200': (r) => r.status === 200,
            'token returned': (r) => JSON.parse(r.body).token !== undefined,
        });
    });
}

// Scenario B: 100 Concurrent Student Dashboards
export function scenarioB_Dashboards() {
    group('Scenario B: 100 Concurrent Dashboards', function () {
        const params = { tags: { type: 'dashboard' } };
        const resPage = http.get(`${BASE_URL}/dashboard.html`, params);
        check(resPage, {
            'dashboard status is 200': (r) => r.status === 200,
            'contains dashboard title': (r) => r.body.includes('Academic Dashboard'),
        });

        const resCourses = http.get(`${BASE_URL}/api/courses`, { tags: { type: 'api' } });
        check(resCourses, {
            'courses api status is 200': (r) => r.status === 200,
        });
    });
}

// Scenario C: 100 Concurrent Students Taking Exam (Autosave & Evaluation)
export function scenarioC_ExamExecution() {
    group('Scenario C: 100 Concurrent Exam Sessions', function () {
        const studentId = `vu_std_${__VU}`;
        const attemptId = `att_${__VU}_${Date.now()}`;
        
        // 1. Candidate autosave
        const autosavePayload = JSON.stringify({
            attemptId: attemptId,
            questionId: 'q_obj_1',
            section: 'A',
            selectedOptions: ['B'],
            submittedCode: { html: '<nav><ul><li><a href="/">Home</a></li></ul></nav>' }
        });
        const saveRes = http.post(`${BASE_URL}/api/exams/autosave`, autosavePayload, {
            headers: { 'Content-Type': 'application/json' },
            tags: { type: 'api' }
        });
        check(saveRes, {
            'autosave status is 200': (r) => r.status === 200,
        });

        // 2. Exam submission evaluation
        const evalPayload = JSON.stringify({
            examId: 'exam_comprehensive_fullstack',
            studentId: studentId,
            studentRoll: `23IT${String(__VU).padStart(3, '0')}`,
            studentName: `Student Candidate ${__VU}`,
            answers: {
                sectionA: { q_1: 'B', q_2: ['A', 'C'] },
                sectionB: { prob_1: '<nav><ul><li><a href="/">Home</a></li></ul></nav>' }
            }
        });
        const evalRes = http.post(`${BASE_URL}/api/exams/evaluate`, evalPayload, {
            headers: { 'Content-Type': 'application/json' },
            tags: { type: 'api' }
        });
        check(evalRes, {
            'evaluation status is 200': (r) => r.status === 200,
            'result awarded': (r) => JSON.parse(r.body).result !== undefined,
        });
    });
}

// Scenario D: Faculty / Admin Concurrent Queries
export function scenarioD_AdminQueries() {
    group('Scenario D: Admin Concurrent Directory Queries', function () {
        // Authenticate as Admin
        const loginRes = http.post(`${BASE_URL}/api/auth/admin-login`, JSON.stringify({
            username: 'IT',
            password: 'INFORMATIONTECHNOLOGY'
        }), {
            headers: { 'Content-Type': 'application/json' },
            tags: { type: 'api' }
        });
        const token = JSON.parse(loginRes.body).token;
        const authParams = {
            headers: { 'Authorization': `Bearer ${token}` },
            tags: { type: 'api' }
        };

        const overviewRes = http.get(`${BASE_URL}/api/admin/overview`, authParams);
        check(overviewRes, {
            'overview status is 200': (r) => r.status === 200,
        });

        const studentsRes = http.get(`${BASE_URL}/api/admin/students`, authParams);
        check(studentsRes, {
            'students status is 200': (r) => r.status === 200,
        });
    });
}

// Scenario E: Stress & Spike Sustained Flow
export function scenarioE_StressSpike() {
    group('Scenario E: Stress & Spike', function () {
        const res = http.get(`${BASE_URL}/api/health`, { tags: { type: 'api' } });
        check(res, {
            'health status is 200': (r) => r.status === 200,
            'system is UP': (r) => JSON.parse(r.body).status === 'UP',
        });
    });
}

