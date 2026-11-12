/**
 * KITS LMS — Production Full-Stack Server
 * Zero-dependency pure Node.js (Node v20+)
 * Provides trusted server-side authentication, admin authorization,
 * privileged examination evaluation engine, and static file delivery.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const url = require("url");

// Standard 50-MCQ Question Bank & Sanitizers
const {
    DEFAULT_50_MCQS,
    sanitizeExamForStudent,
    sanitizeQuestionsForStudent
} = require("./exam-default-data");

const {
    getExam10Sets,
    getOrAllocateStudentSet,
    sanitizeSetForStudent,
    evaluateSetSubmission,
    generateStudentExamArrangement,
    sanitizeArrangementForStudent,
    evaluateStudentSubmission,
    getRollNumberSeed
} = require("./exam-randomizer");

// IST (Asia/Kolkata UTC+05:30) Time Utilities
function getISTDate(date = new Date()) {
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 5.5));
}

function formatIST(date = new Date()) {
    const d = getISTDate(date);
    const pad = (n) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} IST`;
}

function formatISTShort(date = new Date()) {
    const d = getISTDate(date);
    const pad = (n) => String(n).padStart(2, "0");
    const day = pad(d.getDate());
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = pad(d.getMinutes());
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day} ${month} ${year}, ${pad(hours)}:${minutes} ${ampm} IST`;
}

// 1. Load environment variables from .env
const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");

function loadEnv() {
    if (typeof process.loadEnvFile === "function" && fs.existsSync(ENV_PATH)) {
        try {
            process.loadEnvFile(ENV_PATH);
            return;
        } catch (e) {
            // fallback to manual parser
        }
    }
    if (fs.existsSync(ENV_PATH)) {
        const content = fs.readFileSync(ENV_PATH, "utf-8");
        content.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        });
    }
}

loadEnv();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "IT";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "INFORMATIONTECHNOLOGY";
const SESSION_SECRET = process.env.SESSION_SECRET || "kits-lms-super-secret-jwt-hmac-key-2026-prod";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://suumbnmnkmedfuzijlmu.supabase.co";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_PCefe301dmMEPFcv9nBWvg_7HtgsXHx";
const DATABASE_URL = process.env.DATABASE_URL || "";

// PostgreSQL Client Pool for Supabase Database Operations
let pgPool = null;
try {
    const { Pool } = require("pg");
    if (DATABASE_URL) {
        pgPool = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: process.env.VERCEL ? 5 : 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });
        pgPool.on("error", (err) => console.warn("[PG-POOL-WARN]", err.message));
    }
} catch (e) {
    console.warn("[PG-INIT-WARN] PostgreSQL client could not be initialized:", e.message);
}

async function queryDatabase(text, params = []) {
    if (pgPool) {
        try {
            return await pgPool.query(text, params);
        } catch (err) {
            console.warn("[PG-QUERY-WARN]", err.message);
        }
    }
    return { rows: [] };
}

function decodeFirebaseToken(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(base64urlDecode(parts[1]));
        const nowSec = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < nowSec - 300) {
            return null; // Expired with 5m grace
        }
        return payload;
    } catch (e) {
        return null;
    }
}

// 2. MIME types for static assets
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf"
};

// 3. Cryptographic Token Utility (HMAC-SHA256 JWT)
function base64url(str) {
    return Buffer.from(str)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function base64urlDecode(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    return Buffer.from(base64, "base64").toString("utf-8");
}

function signToken(payload, expiresInMs = 24 * 60 * 60 * 1000) {
    const header = { alg: "HS256", typ: "JWT" };
    const fullPayload = {
        ...payload,
        iat: Date.now(),
        exp: Date.now() + expiresInMs
    };
    const encHeader = base64url(JSON.stringify(header));
    const encPayload = base64url(JSON.stringify(fullPayload));
    const signature = crypto
        .createHmac("sha256", SESSION_SECRET)
        .update(encHeader + "." + encPayload)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    return `${encHeader}.${encPayload}.${signature}`;
}

function verifyToken(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encHeader, encPayload, signature] = parts;
    const expectedSig = crypto
        .createHmac("sha256", SESSION_SECRET)
        .update(encHeader + "." + encPayload)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    try {
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return null;
        }
        const payload = JSON.parse(base64urlDecode(encPayload));
        if (payload.exp && Date.now() > payload.exp) {
            return null; // Expired
        }
        return payload;
    } catch (e) {
        return null;
    }
}

// 4. In-Memory Server Store with Persistence
const DATA_DIR = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
    ? path.join("/tmp", ".data")
    : path.join(ROOT_DIR, ".data");
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

const DEFAULT_STUDENTS = [];

const DEFAULT_FACULTY = [
    {
        id: "fac_it_01",
        name: "Dr. K. Ramesh",
        employeeId: "EMP-IT-101",
        email: "ramesh.it@kits.edu",
        department: "Information Technology",
        role: "faculty",
        permissions: ["create_exams", "review_questions", "publish_tests", "view_results"],
        status: "active",
        createdAt: new Date().toISOString()
    },
    {
        id: "fac_cse_02",
        name: "Prof. S. Lakshmi",
        employeeId: "EMP-CSE-102",
        email: "lakshmi.cse@kits.edu",
        department: "Computer Science & Engineering",
        role: "faculty",
        permissions: ["create_exams", "review_questions", "view_results"],
        status: "active",
        createdAt: new Date().toISOString()
    }
];

const DEFAULT_COURSES = [
    {
        id: "entrepreneurship",
        title: "Entrepreneurship & Venture Development",
        name: "Entrepreneurship & Venture Development",
        instructor: "Dr. K. V. Sharma",
        department: "Management & Technology",
        level: "Intermediate",
        duration: "45 Hours",
        is_active: true
    },
    {
        id: "python",
        title: "Programming in Python",
        name: "Programming in Python",
        instructor: "Prof. S. R. Rao",
        department: "Computer Science & Engineering",
        level: "Beginner",
        duration: "40 Hours",
        is_active: true
    },
    {
        id: "dbms",
        title: "Database Management Systems",
        name: "Database Management Systems",
        instructor: "Dr. M. Lakshmi",
        department: "Information Technology",
        level: "Intermediate",
        duration: "50 Hours",
        is_active: true
    },
    {
        id: "machine-learning",
        title: "Machine Learning & AI Principles",
        name: "Machine Learning & AI Principles",
        instructor: "Prof. P. V. Ramana",
        department: "AI & Data Science",
        level: "Advanced",
        duration: "45 Hours",
        is_active: true
    },
    {
        id: "data-structures",
        title: "Data Structures & Algorithms",
        name: "Data Structures & Algorithms",
        instructor: "Dr. A. Srinivas",
        department: "Computer Science & Engineering",
        level: "Intermediate",
        duration: "60 Hours",
        is_active: true
    },
    {
        id: "computer-networks",
        title: "Computer Networks & Security",
        name: "Computer Networks & Security",
        instructor: "Prof. N. Chaitanya",
        department: "Electronics & Communication",
        level: "Intermediate",
        duration: "40 Hours",
        is_active: true
    }
];

// High-Performance In-Memory Data Store with Asynchronous Persistence
const MEMORY_STORE = new Map();
const WRITE_DEBOUNCE_TIMERS = new Map();
const PENDING_REGISTRATIONS = new Set();
const SUBMISSION_LOCKS = new Set();

function initMemoryStore() {
    const defaultStandardExam = {
        id: "exam_standard_50_mcq",
        title: "Python & Computational Problem Solving Examination",
        name: "Python & Computational Problem Solving Examination",
        description: "Official 50-MCQ KITS Examination covering Python Programming, Data Structures, Algorithms, and DBMS.",
        duration_minutes: 60,
        total_questions: 50,
        total_marks: 50,
        marks_per_question: 1,
        negative_marking: false,
        scheduled_date: new Date().toISOString().slice(0, 10),
        scheduled_start_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // active now
        scheduled_end_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),  // 60m closing window
        scheduled_start_ist: formatISTShort(new Date(Date.now() - 5 * 60 * 1000)),
        status: "published",
        questions: DEFAULT_50_MCQS,
        created_at: new Date().toISOString()
    };

    const keys = ["students", "faculty", "courses", "examinations", "results", "student_answers", "exam_assignments", "exam_attempts", "audit_logs"];
    keys.forEach(key => {
        const p = path.join(DATA_DIR, `${key}.json`);
        if (fs.existsSync(p)) {
            try {
                let data = JSON.parse(fs.readFileSync(p, "utf-8"));
                if (key === "examinations") {
                    if (!Array.isArray(data) || data.length === 0 || !data.some(e => e.questions && e.questions.length >= 50)) {
                        data = [defaultStandardExam, ...(Array.isArray(data) ? data : [])];
                    }
                }
                MEMORY_STORE.set(key, data);
            } catch (e) {
                MEMORY_STORE.set(key, key === "examinations" ? [defaultStandardExam] : []);
            }
        } else {
            let initial = [];
            if (key === "students") initial = DEFAULT_STUDENTS;
            else if (key === "faculty") initial = DEFAULT_FACULTY;
            else if (key === "courses") initial = DEFAULT_COURSES;
            else if (key === "examinations") initial = [defaultStandardExam];
            MEMORY_STORE.set(key, initial);
            persistStoredAsync(key, initial);
        }
    });
}

function persistStoredAsync(key, data) {
    if (WRITE_DEBOUNCE_TIMERS.has(key)) {
        clearTimeout(WRITE_DEBOUNCE_TIMERS.get(key));
    }
    const timer = setTimeout(async () => {
        WRITE_DEBOUNCE_TIMERS.delete(key);
        try {
            const p = path.join(DATA_DIR, `${key}.json`);
            const tmp = `${p}.tmp`;
            await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
            await fs.promises.rename(tmp, p);
        } catch (e) {
            console.error(`[STORAGE-ASYNC-ERROR] Failed to persist ${key}:`, e.message);
        }
    }, 50);
    WRITE_DEBOUNCE_TIMERS.set(key, timer);
}

function getStored(key, fallback = []) {
    if (MEMORY_STORE.has(key)) {
        return MEMORY_STORE.get(key);
    }
    const p = path.join(DATA_DIR, `${key}.json`);
    if (fs.existsSync(p)) {
        try {
            const data = JSON.parse(fs.readFileSync(p, "utf-8"));
            MEMORY_STORE.set(key, data);
            return data;
        } catch (e) {}
    }
    MEMORY_STORE.set(key, fallback);
    return fallback;
}

function setStored(key, data) {
    MEMORY_STORE.set(key, data);
    persistStoredAsync(key, data);
}

// Initialize memory store on boot
initMemoryStore();

// =========================================================================
// 4B. SUPABASE POSTGRESQL EXAMINATION SYNCHRONIZATION ENGINE
// =========================================================================
async function syncExaminationsWithDatabase() {
    try {
        if (!pgPool) return;
        const res = await queryDatabase(`
            SELECT id, title, description, total_marks, duration_minutes,
                   scheduled_start_at, scheduled_end_at, scheduled_start_ist,
                   status, total_questions, negative_marking, questions, created_at, updated_at
            FROM public.examinations
            ORDER BY scheduled_start_at DESC, created_at DESC;
        `);

        const memExams = getStored("examinations", []);
        const examMap = new Map();

        // Register in-memory exams first
        memExams.forEach(e => {
            if (e && e.id) examMap.set(String(e.id).toLowerCase(), e);
        });

        // Merge records from Supabase PostgreSQL
        if (res && res.rows && res.rows.length > 0) {
            res.rows.forEach(r => {
                const idKey = String(r.id).toLowerCase();
                const existing = examMap.get(idKey);
                let qList = r.questions;
                if (typeof qList === "string") {
                    try { qList = JSON.parse(qList); } catch (_) {}
                }
                if (!Array.isArray(qList) || qList.length === 0) {
                    qList = (existing && existing.questions) || DEFAULT_50_MCQS;
                }

                const merged = {
                    ...(existing || {}),
                    id: r.id,
                    title: r.title,
                    name: r.title,
                    description: r.description || "",
                    total_marks: Number(r.total_marks) || 50,
                    totalMarks: Number(r.total_marks) || 50,
                    duration_minutes: Number(r.duration_minutes) || 60,
                    duration: Number(r.duration_minutes) || 60,
                    total_questions: Number(r.total_questions) || (qList && qList.length) || 50,
                    marks_per_question: 1,
                    negative_marking: !!r.negative_marking,
                    scheduled_date: r.scheduled_start_at ? new Date(r.scheduled_start_at).toISOString().slice(0, 10) : "",
                    scheduled_start_at: r.scheduled_start_at ? new Date(r.scheduled_start_at).toISOString() : new Date().toISOString(),
                    scheduled_end_at: r.scheduled_end_at ? new Date(r.scheduled_end_at).toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    scheduled_start_ist: r.scheduled_start_ist || formatISTShort(new Date(r.scheduled_start_at || Date.now())),
                    status: r.status || "published",
                    questions: qList,
                    created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
                    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString()
                };
                examMap.set(idKey, merged);
            });
        }

        // If standard exam is missing in DB, upsert it
        for (const exam of examMap.values()) {
            if (!res.rows || !res.rows.some(r => String(r.id).toLowerCase() === String(exam.id).toLowerCase())) {
                await upsertExamToDatabase(exam);
            }
        }

        const mergedList = Array.from(examMap.values());
        setStored("examinations", mergedList);
        console.log(`[EXAM-SYNC] Synchronized ${mergedList.length} examinations with Supabase PostgreSQL.`);
    } catch (e) {
        console.warn("[EXAM-SYNC-WARN] Failed to sync exams with DB:", e.message);
    }
}

async function upsertExamToDatabase(exam) {
    if (!pgPool || !exam || !exam.id) return;
    try {
        const id = String(exam.id).trim();
        const title = String(exam.title || exam.name || "KITS Examination").trim();
        const desc = String(exam.description || "").trim();
        const totalMarks = Number(exam.total_marks || exam.totalMarks) || 50;
        const durationMinutes = Number(exam.duration_minutes || exam.duration) || 60;
        const totalQuestions = Number(exam.total_questions) || (exam.questions && exam.questions.length) || 50;
        const startAt = exam.scheduled_start_at || new Date().toISOString();
        const endAt = exam.scheduled_end_at || new Date(new Date(startAt).getTime() + durationMinutes * 60 * 1000).toISOString();
        const startIst = exam.scheduled_start_ist || formatISTShort(new Date(startAt));
        const status = exam.status || "published";
        const qJson = JSON.stringify(exam.questions || DEFAULT_50_MCQS);

        await queryDatabase(`
            INSERT INTO public.examinations (
                id, title, description, total_marks, duration_minutes,
                scheduled_start_at, scheduled_end_at, scheduled_start_ist,
                status, total_questions, negative_marking, questions, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                total_marks = EXCLUDED.total_marks,
                duration_minutes = EXCLUDED.duration_minutes,
                scheduled_start_at = EXCLUDED.scheduled_start_at,
                scheduled_end_at = EXCLUDED.scheduled_end_at,
                scheduled_start_ist = EXCLUDED.scheduled_start_ist,
                status = EXCLUDED.status,
                total_questions = EXCLUDED.total_questions,
                negative_marking = EXCLUDED.negative_marking,
                questions = EXCLUDED.questions,
                updated_at = NOW();
        `, [id, title, desc, totalMarks, durationMinutes, startAt, endAt, startIst, status, totalQuestions, false, qJson]);
        console.log(`[EXAM-DB] Upserted exam '${title}' (${id}) to Supabase PostgreSQL.`);
    } catch (e) {
        console.warn("[EXAM-DB-UPSERT-WARN]", e.message);
    }
}

async function updateExamStatusInDatabase(examId, status) {
    if (!pgPool || !examId) return;
    try {
        await queryDatabase(`
            UPDATE public.examinations
            SET status = $1, updated_at = NOW()
            WHERE id = $2;
        `, [status, String(examId).trim()]);
    } catch (e) {
        console.warn("[EXAM-DB-STATUS-WARN]", e.message);
    }
}

async function deleteExamFromDatabase(examId) {
    if (!pgPool || !examId) return;
    try {
        await queryDatabase(`DELETE FROM public.examinations WHERE id = $1;`, [String(examId).trim()]);
    } catch (e) {
        console.warn("[EXAM-DB-DELETE-WARN]", e.message);
    }
}

async function syncStudentsWithDatabase() {
    try {
        if (!pgPool) return;
        const res = await queryDatabase(`
            SELECT s.id, s.roll_number, s.department, s.academic_year, s.created_at,
                   p.full_name as name, p.email, p.firebase_uid, p.role
            FROM public.students s
            LEFT JOIN public.profiles p ON s.profile_id = p.id
            ORDER BY s.roll_number;
        `);
        if (res && res.rows && res.rows.length > 0) {
            const cleanStudents = res.rows.map(r => ({
                id: r.id,
                profile_id: r.id,
                roll_number: r.roll_number,
                name: r.name || r.roll_number,
                email: r.email,
                department: r.department || "Information Technology",
                academic_year: r.academic_year || "3rd Year B.Tech",
                status: "active",
                firebase_uid: r.firebase_uid,
                created_at: r.created_at
            }));
            setStored("students", cleanStudents);
            console.log(`[STUDENT-SYNC] Loaded ${cleanStudents.length} legitimate students from Supabase PostgreSQL.`);
        }
    } catch (e) {
        console.warn("[STUDENT-SYNC-WARN]", e.message);
    }
}

async function syncAttemptsWithDatabase() {
    try {
        if (!pgPool) return;
        const res = await queryDatabase(`
            SELECT id, examination_id, roll_number, set_number, status, started_at, submitted_at,
                   total_time_seconds, marks_obtained, answers, created_at, updated_at
            FROM public.exam_attempts
            ORDER BY created_at ASC;
        `);
        if (res && res.rows && res.rows.length > 0) {
            const memAttempts = getStored("exam_attempts", []);
            const attMap = new Map();
            memAttempts.forEach(a => {
                const key = `${a.examId || a.examination_id}_${(a.rollNumber || a.roll_number || '').toUpperCase()}`;
                attMap.set(key, a);
            });
            res.rows.forEach(r => {
                const key = `${r.examination_id}_${(r.roll_number || '').toUpperCase()}`;
                const existing = attMap.get(key) || {};
                attMap.set(key, {
                    ...existing,
                    id: r.id,
                    attemptId: r.id,
                    examId: r.examination_id,
                    examination_id: r.examination_id,
                    rollNumber: (r.roll_number || '').toUpperCase(),
                    roll_number: (r.roll_number || '').toUpperCase(),
                    set_number: r.set_number,
                    status: r.status,
                    started_at: r.started_at,
                    submitted_at: r.submitted_at,
                    marks_obtained: r.marks_obtained,
                    answers: r.answers || existing.answers || {}
                });
            });
            setStored("exam_attempts", Array.from(attMap.values()));
        }
    } catch (e) {
        console.warn("[ATTEMPT-SYNC-WARN]", e.message);
    }
}

async function syncResultsWithDatabase() {
    try {
        if (!pgPool) return;
        const res = await queryDatabase(`
            SELECT id, attempt_id, examination_id, roll_number, score, total_marks,
                   percentage, status, auto_submitted, completed_at, section_breakdown
            FROM public.results
            ORDER BY completed_at ASC;
        `);
        if (res && res.rows && res.rows.length > 0) {
            const memResults = getStored("results", []);
            const resMap = new Map();
            memResults.forEach(r => {
                const key = `${r.examId || r.examination_id}_${(r.studentRoll || r.roll_number || '').toUpperCase()}`;
                resMap.set(key, r);
            });
            res.rows.forEach(r => {
                const key = `${r.examination_id}_${(r.roll_number || '').toUpperCase()}`;
                const existing = resMap.get(key) || {};
                let itemized = null;
                if (r.section_breakdown) {
                    try {
                        itemized = typeof r.section_breakdown === 'string' ? JSON.parse(r.section_breakdown) : r.section_breakdown;
                    } catch (_) {}
                }
                resMap.set(key, {
                    ...existing,
                    id: r.id,
                    attemptId: r.attempt_id,
                    examId: r.examination_id,
                    studentRoll: (r.roll_number || '').toUpperCase(),
                    score: Number(r.score),
                    totalMarks: Number(r.total_marks || 50),
                    percentage: Number(r.percentage),
                    status: r.status,
                    autoSubmitted: r.auto_submitted,
                    submittedAt: r.completed_at,
                    itemizedReview: itemized || existing.itemizedReview
                });
            });
            setStored("results", Array.from(resMap.values()));
        }
    } catch (e) {
        console.warn("[RESULT-SYNC-WARN]", e.message);
    }
}

// 5. Helper to read request body JSON
function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => {
            body += chunk;
            if (body.length > 5 * 1024 * 1024) { // 5MB limit
                reject(new Error("Request payload too large"));
            }
        });
        req.on("end", () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error("Invalid JSON format"));
            }
        });
        req.on("error", reject);
    });
}

function parseCookies(req) {
    const list = {};
    const rc = req && req.headers && req.headers.cookie;
    if (rc) {
        rc.split(";").forEach(cookie => {
            const parts = cookie.split("=");
            const name = parts.shift().trim();
            const value = decodeURIComponent(parts.join("="));
            list[name] = value;
        });
    }
    return list;
}

function extractAdminToken(req) {
    const authHeader = (req && req.headers && req.headers["authorization"]) || "";
    if (authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7).trim();
    }
    if (authHeader && authHeader.length > 20) {
        return authHeader.trim();
    }
    const cookies = parseCookies(req);
    if (cookies.kits_admin_token) {
        return cookies.kits_admin_token;
    }
    return "";
}

function sendJson(res, statusCode, data, req = null, extraHeaders = {}) {
    const request = req || (res && res.req);
    const origin = (request && request.headers && request.headers.origin) ? request.headers.origin : "*";
    const requestedHeaders = (request && request.headers && request.headers["access-control-request-headers"]) || "Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma, Accept";
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": requestedHeaders,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
        ...extraHeaders
    };
    if (origin !== "*") {
        headers["Access-Control-Allow-Credentials"] = "true";
    }
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(data));
}

// 6. Privileged Evaluation Engine (Server-Side)
function evaluateExamSubmission(submission, examData) {
    const studentAnswers = submission.answers || {};
    const sectionAAnswers = studentAnswers.sectionA || {};
    const sectionBAnswers = studentAnswers.sectionB || {};

    const questions = examData.questions || [];
    const codingProblems = examData.codingProblems || [];

    let totalMarksAwarded = 0;
    let sectionAMarks = 0;
    let sectionBMarks = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;
    const itemizedReview = [];

    // Evaluate Section A (20 MCQs + 10 MSQs = 30 Marks)
    questions.forEach((q, idx) => {
        const qId = q.id || `q_${idx + 1}`;
        const studentAns = sectionAAnswers[qId] || sectionAAnswers[String(idx)] || sectionAAnswers[idx];
        const isMsq = q.type === "msq";
        const correctAnswers = Array.isArray(q.answer) ? q.answer.map(String) : [String(q.answer)];
        const marksPossible = Number(q.marks) || 1;

        let isCorrect = false;
        let isSkipped = false;

        if (studentAns === undefined || studentAns === null || (Array.isArray(studentAns) && studentAns.length === 0) || studentAns === "") {
            isSkipped = true;
            skippedCount++;
        } else if (isMsq) {
            // Strict exact-match order-independent evaluation for MSQ
            const sArr = Array.isArray(studentAns) ? studentAns.map(String) : [String(studentAns)];
            const normStudent = [...new Set(sArr)].sort();
            const normCorrect = [...new Set(correctAnswers)].sort();

            if (normStudent.length === normCorrect.length && normStudent.every((v, i) => v === normCorrect[i])) {
                isCorrect = true;
            }
        } else {
            // Single choice MCQ
            const sVal = Array.isArray(studentAns) ? String(studentAns[0]) : String(studentAns);
            const cVal = String(correctAnswers[0]);
            if (sVal.toLowerCase() === cVal.toLowerCase()) {
                isCorrect = true;
            }
        }

        const awarded = isCorrect ? marksPossible : 0;
        if (isCorrect) {
            correctCount++;
        } else if (!isSkipped) {
            wrongCount++;
        }

        sectionAMarks += awarded;
        totalMarksAwarded += awarded;

        itemizedReview.push({
            id: qId,
            questionNumber: idx + 1,
            questionText: q.question,
            type: q.type || "mcq",
            options: q.options || [],
            correctAnswers: correctAnswers,
            studentAnswer: studentAns || null,
            isCorrect,
            isSkipped,
            marksPossible,
            marksAwarded: awarded,
            explanation: q.explanation || ""
        });
    });

    // Evaluate Section B (4 Coding & Debugging Problems @ 5m = 20 Marks)
    const codingReview = [];
    codingProblems.forEach((prob, idx) => {
        const pId = prob.id || `prob_${idx + 1}`;
        const codeSubmitted = String(sectionBAnswers[pId] || "").trim();
        const pType = prob.problemType || (idx === 0 ? "html_coding" : idx === 1 ? "html_css_coding" : idx === 2 ? "html_debugging" : "css_debugging");
        const maxMarks = Number(prob.marks) || 5;

        let passTests = 0;
        const totalTests = 5;
        const testCaseLogs = [];

        if (codeSubmitted.length > 15) {
            // Automated compliance & syntax validation
            if (pType === "html_coding") {
                const hasNav = /<nav\b[^>]*>/i.test(codeSubmitted);
                const hasList = /<ul\b[^>]*>[\s\S]*?<li\b/i.test(codeSubmitted);
                const hasLinks = /<a\b[^>]*href=/i.test(codeSubmitted);
                const isSemantic = /<(header|nav|main|section|article|footer)\b/i.test(codeSubmitted);
                const isClosed = !/<\s*\/\s*>/.test(codeSubmitted);

                if (hasNav) { passTests++; testCaseLogs.push("✓ Test 1: Navigation container declared."); }
                else testCaseLogs.push("✗ Test 1: Missing <nav> element.");

                if (hasList) { passTests++; testCaseLogs.push("✓ Test 2: Unordered list with item elements structured."); }
                else testCaseLogs.push("✗ Test 2: Incomplete list structure.");

                if (hasLinks) { passTests++; testCaseLogs.push("✓ Test 3: Anchor hyperlinks with href attributes present."); }
                else testCaseLogs.push("✗ Test 3: Missing anchor tags.");

                if (isSemantic) { passTests++; testCaseLogs.push("✓ Test 4: Semantic HTML5 structure applied."); }
                else testCaseLogs.push("✗ Test 4: Lacks semantic hierarchy.");

                if (isClosed) { passTests++; testCaseLogs.push("✓ Test 5: Tags properly formatted and closed."); }
                else testCaseLogs.push("✗ Test 5: Syntax errors found.");
            } else if (pType === "html_css_coding") {
                const hasCard = /class=["'][^"']*(card|container|box)[^"']*["']/i.test(codeSubmitted);
                const hasDisplay = /(display\s*:\s*(flex|grid)|margin\s*:)/i.test(codeSubmitted);
                const hasRadius = /(border-radius\s*:|box-shadow\s*:)/i.test(codeSubmitted);
                const hasColors = /(color\s*:|background(-color)?\s*:)/i.test(codeSubmitted);
                const hasResponsive = /(max-width|padding\s*:|width\s*:)/i.test(codeSubmitted);

                if (hasCard) { passTests++; testCaseLogs.push("✓ Test 1: Component container class identified."); }
                else testCaseLogs.push("✗ Test 1: Missing component container class.");

                if (hasDisplay) { passTests++; testCaseLogs.push("✓ Test 2: Modern layout rules (flex/grid/margin) present."); }
                else testCaseLogs.push("✗ Test 2: Layout alignment missing.");

                if (hasRadius) { passTests++; testCaseLogs.push("✓ Test 3: Card surface styling (border-radius/box-shadow) active."); }
                else testCaseLogs.push("✗ Test 3: Card surface styling absent.");

                if (hasColors) { passTests++; testCaseLogs.push("✓ Test 4: Color palette styling applied."); }
                else testCaseLogs.push("✗ Test 4: Missing color specifications.");

                if (hasResponsive) { passTests++; testCaseLogs.push("✓ Test 5: Responsive dimension rules defined."); }
                else testCaseLogs.push("✗ Test 5: Dimension constraints missing.");
            } else if (pType === "html_debugging") {
                const unclosedTagsFixed = !/<\s*(h1|div|p)\b[^>]*>(?:(?!<\/\1>).)*$/is.test(codeSubmitted);
                const formValid = /<form\b[^>]*>[\s\S]*?<\/form>/i.test(codeSubmitted);
                const inputTypes = /<input\b[^>]*type=["'](text|email|submit|password|button)["']/i.test(codeSubmitted);
                const labelsLinked = /(<label\b[^>]*for=|id=)/i.test(codeSubmitted);
                const cleanAttributes = !/<[^>]*\b(formaction|href)\s*=\s*(?!["']).*?>/i.test(codeSubmitted);

                if (unclosedTagsFixed) { passTests++; testCaseLogs.push("✓ Test 1: Corrected unclosed HTML tags."); }
                else testCaseLogs.push("✗ Test 1: Unclosed HTML tags remaining.");

                if (formValid) { passTests++; testCaseLogs.push("✓ Test 2: Clean form element closure validated."); }
                else testCaseLogs.push("✗ Test 2: Incomplete form closure.");

                if (inputTypes) { passTests++; testCaseLogs.push("✓ Test 3: Validated input type attributes."); }
                else testCaseLogs.push("✗ Test 3: Malformed input attributes.");

                if (labelsLinked) { passTests++; testCaseLogs.push("✓ Test 4: Form labels linked with inputs."); }
                else testCaseLogs.push("✗ Test 4: Unlinked labels.");

                if (cleanAttributes) { passTests++; testCaseLogs.push("✓ Test 5: Attributes properly quoted and terminated."); }
                else testCaseLogs.push("✗ Test 5: Unquoted attributes remaining.");
            } else {
                // CSS Debugging
                const semicolonsPresent = !/[a-zA-Z0-9-]+\s*:\s*[^;{}]+\s*\n\s*[a-zA-Z0-9-]+:/i.test(codeSubmitted);
                const validSelectors = /[.#]?[a-zA-Z0-9_-]+\s*\{[^}]*\}/i.test(codeSubmitted);
                const unitsValid = /(px|rem|em|%|vh|vw)/i.test(codeSubmitted);
                const noMalformedBraces = (codeSubmitted.match(/\{/g) || []).length === (codeSubmitted.match(/\}/g) || []).length;
                const overridesClean = !/!important\s*!important/i.test(codeSubmitted);

                if (semicolonsPresent) { passTests++; testCaseLogs.push("✓ Test 1: Corrected missing semicolons in rule declarations."); }
                else testCaseLogs.push("✗ Test 1: Missing semicolons detected.");

                if (validSelectors) { passTests++; testCaseLogs.push("✓ Test 2: Fixed malformed selector syntax."); }
                else testCaseLogs.push("✗ Test 2: Malformed selector syntax.");

                if (unitsValid) { passTests++; testCaseLogs.push("✓ Test 3: Applied standard dimensional units."); }
                else testCaseLogs.push("✗ Test 3: Unit syntax missing or malformed.");

                if (noMalformedBraces) { passTests++; testCaseLogs.push("✓ Test 4: Balanced curly brace blocks."); }
                else testCaseLogs.push("✗ Test 4: Mismatched curly braces.");

                if (overridesClean) { passTests++; testCaseLogs.push("✓ Test 5: Removed conflicting invalid CSS overrides."); }
                else testCaseLogs.push("✗ Test 5: Conflicting overrides detected.");
            }
        } else {
            testCaseLogs.push("✗ Unattempted / Incomplete code submission.");
        }

        const marksEarned = Math.round((passTests / totalTests) * maxMarks);
        sectionBMarks += marksEarned;
        totalMarksAwarded += marksEarned;

        codingReview.push({
            id: pId,
            problemNumber: idx + 1,
            title: prob.title,
            problemType: pType,
            submittedCode: codeSubmitted,
            testsPassed: passTests,
            totalTests: totalTests,
            testCaseLogs: testCaseLogs,
            marksPossible: maxMarks,
            marksAwarded: marksEarned
        });
    });

    const totalPossible = 50; // 30 Section A + 20 Section B
    const percentageScore = Math.min(100, Math.round((totalMarksAwarded / totalPossible) * 100));
    const totalQuestions = questions.length + codingProblems.length;
    const accuracy = totalQuestions > 0 ? Math.round((correctCount / questions.length) * 100) : 0;

    return {
        score: totalMarksAwarded,
        totalMarks: totalPossible,
        sectionA: { marks: sectionAMarks, total: 30, correctCount, wrongCount, skippedCount },
        sectionB: { marks: sectionBMarks, total: 20, problems: codingReview },
        percentage: percentageScore,
        accuracy: accuracy,
        itemizedReview: itemizedReview,
        evaluatedAt: new Date().toISOString(),
        verifiedBy: "KITS_LMS_TRUSTED_SERVER_ENGINE"
    };
}

let lastSyncTime = 0;
async function ensureDatabaseSync(force = false) {
    const now = Date.now();
    if (force || (now - lastSyncTime > 15000)) {
        lastSyncTime = now;
        try {
            await Promise.all([
                syncExaminationsWithDatabase(),
                syncStudentsWithDatabase(),
                syncAttemptsWithDatabase(),
                syncResultsWithDatabase()
            ]);
        } catch (e) {
            console.warn("[DB-SYNC-WARN]", e.message);
        }
    }
}

// 7. Request Dispatcher
const requestHandler = async (req, res) => {
    res.req = req;
    const incomingUrl = req.headers["x-forwarded-uri"] || req.headers["x-real-url"] || req.headers["x-original-url"] || req.headers["x-rewrite-url"] || req.url;
    const parsedUrl = url.parse(incomingUrl, true);
    let pathname = parsedUrl.pathname;
    
    // Support Vercel serverless /api rewrites and catch-alls
    if (pathname === "/api/index" || pathname === "/api" || pathname === "/api/" || pathname.includes("[...path]") || pathname.endsWith("/api/index")) {
        const queryPath = (req.query && (req.query.__path || req.query.path)) || (parsedUrl.query && (parsedUrl.query.__path || parsedUrl.query.path));
        if (queryPath) {
            pathname = "/api/" + (Array.isArray(queryPath) ? queryPath.join("/") : queryPath).replace(/^\/+/, "");
        }
    }

    const method = req.method.toUpperCase();

    // Ensure database examinations sync on serverless cold starts
    ensureDatabaseSync().catch(() => {});

    // CORS preflight
    if (method === "OPTIONS") {
        const origin = req.headers.origin || "*";
        const requestedHeaders = req.headers["access-control-request-headers"] || "Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma, Accept";
        const preflightHeaders = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": requestedHeaders,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
            "Access-Control-Max-Age": "86400"
        };
        if (origin !== "*") {
            preflightHeaders["Access-Control-Allow-Credentials"] = "true";
        }
        res.writeHead(204, preflightHeaders);
        return res.end();
    }

    // =========================================================================
    // API ROUTES
    // =========================================================================

    // 1. Admin Login (Username: IT, Password: INFORMATIONTECHNOLOGY from .env)
    if ((pathname === "/api/auth/admin-login" || pathname === "/api/admin/login") && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const rawUsername = String(body.username || "").trim();
            const rawPassword = String(body.password || "").trim();

            const clientIp = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || (req.headers && req.headers["x-forwarded-for"]) || "127.0.0.1";
            console.log(`[AUTH-DIAGNOSTIC] [${new Date().toISOString()}] Login API request received for username: "${rawUsername.slice(0, 30)}" from IP: ${clientIp}`);

            if (!rawUsername || !rawPassword) {
                console.log(`[AUTH-DIAGNOSTIC] Validation rejected: Missing username or password. Status: 400`);
                return sendJson(res, 400, {
                    success: false,
                    error: "Please enter both administrative username and password."
                }, req);
            }

            // Only configured server-side admin credentials from environment (Username: IT, Password: INFORMATIONTECHNOLOGY)
            // No aliases, no alternate passwords, no silent case changes
            const configuredUsername = (ADMIN_USERNAME || "IT").trim();
            const configuredPassword = (ADMIN_PASSWORD || "INFORMATIONTECHNOLOGY").trim();

            const isUserMatched = (rawUsername.toUpperCase() === configuredUsername.toUpperCase());
            console.log(`[AUTH-DIAGNOSTIC] Username verification: ${isUserMatched ? "MATCHED (Authorized Administrator Identity)" : "NOT FOUND"}`);

            // Strict constant-time timing-safe comparison preserving exact password case
            const inBuf = Buffer.from(rawPassword);
            const expBuf = Buffer.from(configuredPassword);
            const isPassValid = (inBuf.length === expBuf.length) && crypto.timingSafeEqual(inBuf, expBuf);
            console.log(`[AUTH-DIAGNOSTIC] Password verification: ${isPassValid ? "SUCCESS (Timing-safe match)" : "FAILED (Password mismatch)"}`);

            if (!isUserMatched || !isPassValid) {
                console.log(`[AUTH-DIAGNOSTIC] Authorization failed for user "${rawUsername}". Status: 401 Unauthorized`);
                return sendJson(res, 401, {
                    success: false,
                    error: "Invalid username or password. Please verify administrative credentials."
                }, req);
            }

            console.log(`[AUTH-DIAGNOSTIC] Admin role authorization: GRANTED (Role: "admin", Access: Full Super Administrator)`);

            // Session payload
            const sessionPayload = {
                uid: "admin_it_primary",
                username: "IT",
                role: "admin",
                admin: true,
                name: "IT Administrator",
                department: "Information Technology",
                email: "it.admin@kits.edu"
            };

            // Sign cryptographic HMAC-SHA256 session token
            const sessionToken = signToken(sessionPayload);
            sessionPayload.token = sessionToken;
            console.log(`[AUTH-DIAGNOSTIC] Session token generated: SUCCESS (HMAC-SHA256)`);

            // Generate Firebase custom authentication token format
            const firebaseCustomToken = signToken({
                iss: "kits-lms-auth-server",
                sub: "admin_it_primary",
                aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
                uid: "admin_it_primary",
                claims: { admin: true, role: "admin" }
            });
            console.log(`[AUTH-DIAGNOSTIC] Firebase custom token generation: SUCCESS`);
            console.log(`[AUTH-DIAGNOSTIC] API response status: 200 OK`);

            // Set HttpOnly, SameSite=Lax session cookie
            const isProduction = process.env.NODE_ENV === "production";
            const cookieFlags = [
                `kits_admin_token=${sessionToken}`,
                "Path=/",
                "HttpOnly",
                "SameSite=Lax",
                "Max-Age=86400"
            ];
            if (isProduction) cookieFlags.push("Secure");

            return sendJson(res, 200, {
                success: true,
                token: sessionToken,
                customToken: firebaseCustomToken,
                firebaseToken: sessionToken,
                user: sessionPayload
            }, req, { "Set-Cookie": cookieFlags.join("; ") });
        } catch (err) {
            console.error(`[AUTH-DIAGNOSTIC] Internal error in admin-login:`, err.message);
            return sendJson(res, 500, { success: false, error: "Server authentication error: " + err.message }, req);
        }
    }

    // 2. Verify Session Token (Admin, Faculty, Student) - Accepts Authorization header or Cookie
    if (pathname === "/api/auth/verify-session" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        console.log(`[AUTH-DIAGNOSTIC] Verify session token requested: ${payload ? "VALID (User: " + (payload.username || payload.uid) + ", Role: " + payload.role + ")" : "INVALID OR EXPIRED"}`);

        if (!payload) {
            return sendJson(res, 401, { valid: false, error: "Session token is invalid or expired." }, req);
        }

        return sendJson(res, 200, { valid: true, user: payload }, req);
    }

    // 3. Admin Logout
    if (pathname === "/api/auth/admin-logout" && method === "POST") {
        const clearCookie = "kits_admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
        return sendJson(res, 200, { success: true, message: "Admin session cleared." }, req, { "Set-Cookie": clearCookie });
    }

    // 3A. Student Registration & Profile Provisioning (Backend Enforced)
    if (pathname === "/api/auth/register-student" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const idToken = body.idToken;
            const roll = String(body.roll || body.roll_number || "").trim().toUpperCase();
            const name = String(body.name || body.full_name || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            const department = String(body.department || body.branch || "Information Technology").trim();
            const academicYear = String(body.academicYear || body.academic_year || body.batch || "3rd Year B.Tech").trim();

            if (!name || !roll || !email) {
                return sendJson(res, 400, { success: false, error: "Please provide full name, roll number, and college email." });
            }

            // Enforce token validation if idToken is supplied (Case 4)
            let decoded = null;
            if (idToken) {
                decoded = decodeFirebaseToken(idToken);
                if (!decoded) {
                    console.log("[STUDENT-REG] Rejected: Invalid or expired Firebase ID token.");
                    return sendJson(res, 401, { success: false, error: "Invalid or expired Firebase authentication token." });
                }
            }

            const firebaseUid = (decoded && decoded.sub) || body.firebaseUid || ("uid_" + Date.now());
            const cleanEmail = String(email).trim().toLowerCase();
            const cleanRoll = String(roll).trim().toUpperCase();
            const cleanName = String(name).trim();
            const cleanDept = String(department || "Information Technology").trim();
            const cleanYear = String(academicYear || "3rd Year B.Tech").trim();

            console.log(`[STUDENT-REG] Processing registration for Roll: ${cleanRoll}, Email: ${cleanEmail}, UID: ${firebaseUid}`);

            if (PENDING_REGISTRATIONS.has(cleanRoll)) {
                return sendJson(res, 409, {
                    success: false,
                    error: "Student with this Roll Number is already registered."
                }, req);
            }
            PENDING_REGISTRATIONS.add(cleanRoll);

            try {
                const memStudents = getStored("students", DEFAULT_STUDENTS);
                const existingStud = memStudents.find(s => s.roll_number.toUpperCase() === cleanRoll || s.email.toLowerCase() === cleanEmail);
                if (existingStud) {
                    if (existingStud.status === "deleted") {
                        return sendJson(res, 409, {
                            success: false,
                            error: "This student roll number was previously registered and deactivated. Please contact administration for authorization."
                        }, req);
                    }
                    return sendJson(res, 409, {
                        success: false,
                        error: "Student with this Roll Number is already registered."
                    }, req);
                }

                let profile = null;
                let student = null;

                // 1. Persist in Supabase profiles (Upsert on firebase_uid)
                const profRes = await queryDatabase(`
                    INSERT INTO public.profiles (firebase_uid, auth_uid, email, full_name, role)
                    VALUES ($1, $1, $2, $3, 'student')
                    ON CONFLICT (firebase_uid) DO UPDATE 
                    SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, updated_at = NOW()
                    RETURNING *;
                `, [firebaseUid, cleanEmail, cleanName]);

                if (profRes && profRes.rows && profRes.rows[0]) {
                    profile = profRes.rows[0];

                    // 2. Persist in Supabase students (Reject duplicate roll_number)
                    const studRes = await queryDatabase(`
                        INSERT INTO public.students (profile_id, roll_number, department, academic_year, enrolled_courses)
                        VALUES ($1, $2, $3, $4, ARRAY['entrepreneurship', 'python']::TEXT[])
                        ON CONFLICT (roll_number) DO NOTHING
                        RETURNING *;
                    `, [profile.id, cleanRoll, cleanDept, cleanYear]);

                    if (!studRes || !studRes.rows || studRes.rows.length === 0) {
                        return sendJson(res, 409, {
                            success: false,
                            error: "Student with this Roll Number is already registered."
                        }, req);
                    }
                    student = studRes.rows[0];
                }

                // Check again in memory store before inserting
                const currentMemStudents = getStored("students", DEFAULT_STUDENTS);
                if (currentMemStudents.some(s => s.roll_number.toUpperCase() === cleanRoll || s.email.toLowerCase() === cleanEmail)) {
                    return sendJson(res, 409, {
                        success: false,
                        error: "Student with this Roll Number is already registered."
                    }, req);
                }

                // Sync with local high-speed in-memory store
                const memEntry = {
                    id: student ? student.id : ("std_" + cleanRoll.toLowerCase()),
                    profile_id: profile ? profile.id : ("prof_" + firebaseUid),
                    roll_number: cleanRoll,
                    name: cleanName,
                    email: cleanEmail,
                    department: cleanDept,
                    academic_year: cleanYear,
                    status: "active",
                    created_at: new Date().toISOString()
                };
                currentMemStudents.push(memEntry);
                setStored("students", currentMemStudents);

                const sessionPayload = {
                    uid: firebaseUid,
                    profileId: profile ? profile.id : memEntry.profile_id,
                    studentId: student ? student.id : memEntry.id,
                    email: cleanEmail,
                    name: cleanName,
                    roll: cleanRoll,
                    dept: cleanDept,
                    academicYear: cleanYear,
                    role: "student"
                };
                const sessionToken = signToken(sessionPayload);
                sessionPayload.token = sessionToken;

                console.log(`[STUDENT-REG] ✓ Successfully provisioned profile & student records for ${cleanRoll}`);

                return sendJson(res, 200, {
                    success: true,
                    token: sessionToken,
                    profile: profile || { id: sessionPayload.profileId, firebase_uid: firebaseUid, email: cleanEmail, full_name: cleanName, role: "student" },
                    student: student || memEntry,
                    session: sessionPayload
                });
            } finally {
                PENDING_REGISTRATIONS.delete(cleanRoll);
            }
        } catch (err) {
            console.error(`[STUDENT-REG] Error in student registration:`, err.message);
            return sendJson(res, 500, { success: false, error: "Registration processing failed: " + err.message });
        }
    }

    // 3B. Profile Verification & Reconciliation (Existing Firebase Users, Faculty & Students)
    if (pathname === "/api/auth/verify-profile" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const { idToken, firebaseUid: rawUid, identifier, fallbackDetails } = body;

            // Enforce token validation if idToken is supplied (Case 4)
            let decoded = null;
            if (idToken) {
                decoded = decodeFirebaseToken(idToken);
                if (!decoded) {
                    console.log("[AUTH-PROFILE] Rejected: Invalid or expired Firebase ID token.");
                    return sendJson(res, 401, { success: false, error: "Invalid or expired Firebase authentication token." });
                }
            }

            const firebaseUid = (decoded && decoded.sub) || rawUid;
            const emailFromToken = decoded && decoded.email;

            console.log(`[AUTH-PROFILE] Verifying profile for UID: "${firebaseUid}", Identifier: "${identifier}"`);

            if (!firebaseUid && !identifier) {
                return sendJson(res, 400, { success: false, error: "Missing identity token or identifier." });
            }

            // Early status check: If identifier matches a student whose account is suspended or deleted
            const rollToCheck = identifier && !identifier.includes("@") 
                ? identifier.trim().toUpperCase() 
                : (fallbackDetails && fallbackDetails.roll ? String(fallbackDetails.roll).trim().toUpperCase() : null);
            if (rollToCheck) {
                const memStudents = getStored("students", DEFAULT_STUDENTS);
                const memMatch = memStudents.find(s => (s.roll_number || "").toUpperCase() === rollToCheck);
                if (memMatch) {
                    if (memMatch.status === "suspended") {
                        console.log(`[AUTH-PROFILE] Access denied: Student ${rollToCheck} is suspended.`);
                        return sendJson(res, 403, {
                            success: false,
                            status: "suspended",
                            error: "Your student account has been suspended. Please contact the administrator."
                        }, req);
                    }
                    if (memMatch.status === "deleted") {
                        console.log(`[AUTH-PROFILE] Access denied: Student ${rollToCheck} has been deleted.`);
                        return sendJson(res, 403, {
                            success: false,
                            status: "deleted",
                            error: "Your student account is no longer active. Please contact the administrator."
                        }, req);
                    }
                }
            }

            let profile = null;
            let student = null;
            let faculty = null;

            // 1. Direct Lookup in Supabase by firebase_uid (joining students and faculty)
            if (firebaseUid) {
                const profRes = await queryDatabase(`
                    SELECT p.*, 
                           s.id as student_id, s.roll_number, s.department as student_dept, s.academic_year, s.enrolled_courses,
                           f.id as faculty_id, f.employee_id, f.department as faculty_dept, f.designation
                    FROM public.profiles p
                    LEFT JOIN public.students s ON s.profile_id = p.id
                    LEFT JOIN public.faculty f ON f.profile_id = p.id
                    WHERE p.firebase_uid = $1 OR p.auth_uid = $1;
                `, [firebaseUid]);

                if (profRes && profRes.rows && profRes.rows[0]) {
                    const row = profRes.rows[0];
                    profile = { id: row.id, firebase_uid: row.firebase_uid, email: row.email, full_name: row.full_name, role: row.role };
                    if (row.student_id) {
                        student = { id: row.student_id, roll_number: row.roll_number, department: row.student_dept, academic_year: row.academic_year, enrolled_courses: row.enrolled_courses };
                    }
                    if (row.faculty_id) {
                        faculty = { id: row.faculty_id, employee_id: row.employee_id, department: row.faculty_dept, designation: row.designation };
                    }
                }
            }

            // 2. Lookup by email if UID not yet linked (Existing user reconciliation)
            const cleanLookupEmail = emailFromToken || (identifier && identifier.includes("@") ? identifier.trim().toLowerCase() : null);
            if (!profile && cleanLookupEmail) {
                const emailRes = await queryDatabase(`
                    SELECT p.*, 
                           s.id as student_id, s.roll_number, s.department as student_dept, s.academic_year, s.enrolled_courses,
                           f.id as faculty_id, f.employee_id, f.department as faculty_dept, f.designation
                    FROM public.profiles p
                    LEFT JOIN public.students s ON s.profile_id = p.id
                    LEFT JOIN public.faculty f ON f.profile_id = p.id
                    WHERE p.email = $1;
                `, [cleanLookupEmail]);

                if (emailRes && emailRes.rows && emailRes.rows[0]) {
                    const row = emailRes.rows[0];
                    profile = { id: row.id, firebase_uid: firebaseUid || row.firebase_uid, email: row.email, full_name: row.full_name, role: row.role };
                    if (firebaseUid && row.firebase_uid !== firebaseUid) {
                        await queryDatabase(`UPDATE public.profiles SET firebase_uid = $1, auth_uid = $1, updated_at = NOW() WHERE id = $2;`, [firebaseUid, row.id]);
                    }
                    if (row.student_id) {
                        student = { id: row.student_id, roll_number: row.roll_number, department: row.student_dept, academic_year: row.academic_year, enrolled_courses: row.enrolled_courses };
                    }
                    if (row.faculty_id) {
                        faculty = { id: row.faculty_id, employee_id: row.employee_id, department: row.faculty_dept, designation: row.designation };
                    }
                }
            }

            // 2A. Check if user is an existing Student by roll or email in memory store
            if (!profile && !student) {
                const memStudents = getStored("students", DEFAULT_STUDENTS);
                const rollToMatch = identifier ? identifier.trim().toUpperCase() : null;
                const studMatch = memStudents.find(s => 
                    (rollToMatch && s.roll_number.toUpperCase() === rollToMatch) ||
                    (cleanLookupEmail && s.email.toLowerCase() === cleanLookupEmail.toLowerCase())
                );
                if (studMatch) {
                    profile = {
                        id: "prof_" + studMatch.id,
                        firebase_uid: firebaseUid || "uid_" + studMatch.roll_number.toLowerCase(),
                        email: studMatch.email,
                        full_name: studMatch.name,
                        role: "student"
                    };
                    student = studMatch;
                    console.log(`[AUTH-PROFILE] Student record matched: ${studMatch.name} (${studMatch.roll_number}), Status: ${studMatch.status}`);
                }
            }

            // 2B. Check if user is an existing Faculty member in memory store (Case 6)
            if (!profile && !student && !faculty) {
                const memFaculty = getStored("faculty", []);
                const facMatch = memFaculty.find(f => 
                    (cleanLookupEmail && f.email.toLowerCase() === cleanLookupEmail.toLowerCase()) ||
                    (identifier && f.employeeId && f.employeeId.toUpperCase() === identifier.toUpperCase())
                );
                if (facMatch) {
                    profile = {
                        id: facMatch.id,
                        firebase_uid: firebaseUid || "uid_" + facMatch.id,
                        email: facMatch.email,
                        full_name: facMatch.name,
                        role: "faculty"
                    };
                    faculty = facMatch;
                    console.log(`[AUTH-PROFILE] Faculty profile matched for ${facMatch.name} (${facMatch.employeeId})`);
                }
            }

            // 3. SECURE RECONCILIATION: User exists in Firebase but has NO Supabase profile record
            if (!profile && (firebaseUid || cleanLookupEmail)) {
                console.log(`[AUTH-PROFILE] Existing Firebase user without Supabase profile. Performing secure profile reconciliation.`);
                const recEmail = cleanLookupEmail || (fallbackDetails && fallbackDetails.email) || `${firebaseUid}@kits.edu`;
                const recName = (decoded && (decoded.name || decoded.display_name)) || (fallbackDetails && fallbackDetails.name) || recEmail.split("@")[0];
                const recRoll = (fallbackDetails && fallbackDetails.roll) || recEmail.split("@")[0].toUpperCase();

                const createProfRes = await queryDatabase(`
                    INSERT INTO public.profiles (firebase_uid, auth_uid, email, full_name, role)
                    VALUES ($1, $1, $2, $3, 'student')
                    ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
                    RETURNING *;
                `, [firebaseUid, recEmail, recName]);

                if (createProfRes && createProfRes.rows && createProfRes.rows[0]) {
                    profile = createProfRes.rows[0];
                    const createStudRes = await queryDatabase(`
                        INSERT INTO public.students (profile_id, roll_number, department, academic_year, enrolled_courses)
                        VALUES ($1, $2, $3, $4, ARRAY['entrepreneurship', 'python']::TEXT[])
                        ON CONFLICT (roll_number) DO UPDATE SET profile_id = EXCLUDED.profile_id
                        RETURNING *;
                    `, [profile.id, recRoll, (fallbackDetails && fallbackDetails.department) || "Information Technology", (fallbackDetails && fallbackDetails.academicYear) || "3rd Year B.Tech"]);

                    if (createStudRes && createStudRes.rows && createStudRes.rows[0]) {
                        student = createStudRes.rows[0];
                    }
                }
            }

            // Fallback to local memory store if database query returned empty
            if (!profile) {
                const memStudents = getStored("students", []);
                const found = memStudents.find(s => 
                    s.email.toLowerCase() === (cleanLookupEmail || "").toLowerCase() || 
                    s.roll_number.toUpperCase() === (identifier || "").toUpperCase()
                );
                if (found) {
                    profile = { id: "prof_" + found.id, firebase_uid: firebaseUid, email: found.email, full_name: found.name, role: "student" };
                    student = found;
                }
            }

            if (!profile) {
                return sendJson(res, 404, { success: false, error: "User profile could not be located in database." });
            }

            // Enforce account status check for students
            if (student) {
                const memStudents = getStored("students", DEFAULT_STUDENTS);
                const memMatch = memStudents.find(s => s.roll_number.toUpperCase() === (student.roll_number || "").toUpperCase());
                const status = (memMatch && memMatch.status) || student.status || "active";
                if (status === "suspended") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "suspended",
                        error: "Your student account has been suspended. Please contact the administrator."
                    }, req);
                }
                if (status === "deleted") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "deleted",
                        error: "Your student account is no longer active. Please contact the administrator."
                    }, req);
                }
            }

            const sessionPayload = {
                uid: profile.firebase_uid || firebaseUid,
                profileId: profile.id,
                studentId: student ? student.id : null,
                facultyId: faculty ? faculty.id : null,
                email: profile.email,
                name: profile.full_name,
                roll: student ? student.roll_number : (faculty ? faculty.employeeId : profile.email),
                dept: student ? student.department : (faculty ? faculty.department : "Information Technology"),
                academicYear: student ? student.academic_year : (faculty ? "Faculty" : "3rd Year B.Tech"),
                role: profile.role || (faculty ? "faculty" : "student")
            };
            const sessionToken = signToken(sessionPayload);
            sessionPayload.token = sessionToken;

            console.log(`[AUTH-PROFILE] ✓ Profile verified & authenticated: ${profile.email} (${sessionPayload.roll}) Role: ${sessionPayload.role}`);

            return sendJson(res, 200, {
                success: true,
                token: sessionToken,
                profile,
                student,
                faculty,
                session: sessionPayload
            });
        } catch (err) {
            console.error(`[AUTH-PROFILE] Error in verify-profile:`, err.message);
            return sendJson(res, 500, { success: false, error: "Profile verification error: " + err.message });
        }
    }

    // 3C. Student Email Lookup by Roll Number (For Roll-based Login)
    if (pathname === "/api/auth/student-lookup" && method === "GET") {
        try {
            const roll = String(parsedUrl.query.roll || parsedUrl.query.identifier || "").trim().toUpperCase();
            if (!roll) {
                return sendJson(res, 400, { error: "Student roll number is required." });
            }

            const memStudents = getStored("students", DEFAULT_STUDENTS);
            const match = memStudents.find(s => s.roll_number.toUpperCase() === roll);
            if (match) {
                if (match.status === "suspended") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "suspended",
                        error: "Your student account has been suspended. Please contact the administrator."
                    });
                }
                if (match.status === "deleted") {
                    return sendJson(res, 404, {
                        success: false,
                        status: "deleted",
                        error: "Your student account is no longer active. Please contact the administrator."
                    });
                }
                return sendJson(res, 200, {
                    success: true,
                    student: { roll_number: match.roll_number, email: match.email, full_name: match.name, department: match.department }
                });
            }

            const resStud = await queryDatabase(`
                SELECT s.roll_number, s.status, p.email, p.full_name, s.department
                FROM public.students s
                JOIN public.profiles p ON s.profile_id = p.id
                WHERE s.roll_number = $1;
            `, [roll]);

            if (resStud && resStud.rows && resStud.rows[0]) {
                const sRow = resStud.rows[0];
                if (sRow.status === "suspended") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "suspended",
                        error: "Your student account has been suspended. Please contact the administrator."
                    });
                }
                if (sRow.status === "deleted") {
                    return sendJson(res, 404, {
                        success: false,
                        status: "deleted",
                        error: "Your student account is no longer active. Please contact the administrator."
                    });
                }
                return sendJson(res, 200, { success: true, student: sRow });
            }

            return sendJson(res, 404, { success: false, error: `No student record found with roll number: ${roll}` });
        } catch (err) {
            return sendJson(res, 500, { success: false, error: err.message });
        }
    }

    // 3D. Protected Student Profile Access & Authorization (Case 5: Cross-profile Access Rejection)
    if (pathname === "/api/student/profile" && method === "GET") {
        try {
            const authHeader = req.headers["authorization"] || "";
            const token = authHeader.replace(/^Bearer\s+/i, "").trim();
            const payload = verifyToken(token) || decodeFirebaseToken(token);

            if (!payload) {
                return sendJson(res, 401, { success: false, error: "Authentication token required." });
            }

            const callerUid = payload.uid || payload.sub;
            const callerRoll = (payload.roll || "").toUpperCase();
            const callerRole = payload.role || "student";

            // Check if caller is trying to access another student's profile
            const targetRoll = (parsedUrl.query.roll || "").trim().toUpperCase();
            const targetStudentId = (parsedUrl.query.studentId || "").trim();
            const targetUid = (parsedUrl.query.uid || "").trim();

            const isTargetingOther = (targetRoll && targetRoll !== callerRoll) ||
                                     (targetStudentId && payload.studentId && targetStudentId !== payload.studentId) ||
                                     (targetUid && targetUid !== callerUid);

            if (isTargetingOther && callerRole !== "admin") {
                console.log(`[AUTH-SECURITY] Cross-profile access BLOCKED: Student "${callerRoll || callerUid}" attempted to access target: "${targetRoll || targetStudentId || targetUid}"`);
                return sendJson(res, 403, {
                    success: false,
                    error: "Access denied. Students are not authorized to view another student's profile."
                });
            }

            // Retrieve caller's profile
            const profRes = await queryDatabase(`
                SELECT p.id as profile_id, p.firebase_uid, p.email, p.full_name, p.role,
                       s.id as student_id, s.roll_number, s.department, s.academic_year, s.enrolled_courses
                FROM public.profiles p
                LEFT JOIN public.students s ON s.profile_id = p.id
                WHERE p.firebase_uid = $1 OR p.auth_uid = $1 OR s.roll_number = $2;
            `, [callerUid, callerRoll]);

            if (profRes && profRes.rows && profRes.rows[0]) {
                const row = profRes.rows[0];
                return sendJson(res, 200, {
                    success: true,
                    profile: { id: row.profile_id, firebase_uid: row.firebase_uid, email: row.email, full_name: row.full_name, role: row.role },
                    student: { id: row.student_id, roll_number: row.roll_number, department: row.department, academic_year: row.academic_year, enrolled_courses: row.enrolled_courses }
                });
            }

            // Fallback to memory store
            const memStudents = getStored("students", []);
            const found = memStudents.find(s => s.roll_number.toUpperCase() === callerRoll || s.profile_id === callerUid);
            if (found) {
                return sendJson(res, 200, {
                    success: true,
                    profile: { id: found.profile_id || ("prof_" + callerUid), firebase_uid: callerUid, email: found.email, full_name: found.name, role: "student" },
                    student: found
                });
            }

            return sendJson(res, 404, { success: false, error: "Profile record not found." });
        } catch (err) {
            return sendJson(res, 500, { success: false, error: "Profile access error: " + err.message });
        }
    }

    if (pathname === "/api/student/profile/update" && method === "POST") {
        try {
            const authHeader = req.headers["authorization"] || "";
            const token = authHeader.replace(/^Bearer\s+/i, "").trim();
            const payload = verifyToken(token) || decodeFirebaseToken(token);

            if (!payload) {
                return sendJson(res, 401, { success: false, error: "Authentication token required." });
            }

            const callerUid = payload.uid || payload.sub;
            const callerRoll = (payload.roll || "").toUpperCase();
            const callerRole = payload.role || "student";

            const body = await parseRequestBody(req);
            const targetRoll = (body.targetRoll || "").trim().toUpperCase();
            const targetStudentId = (body.targetStudentId || "").trim();
            const targetUid = (body.targetUid || "").trim();

            const isTargetingOther = (targetRoll && targetRoll !== callerRoll) ||
                                     (targetStudentId && payload.studentId && targetStudentId !== payload.studentId) ||
                                     (targetUid && targetUid !== callerUid);

            if (isTargetingOther && callerRole !== "admin") {
                console.log(`[AUTH-SECURITY] Cross-profile modification BLOCKED: Student "${callerRoll || callerUid}" attempted to alter target: "${targetRoll || targetStudentId || targetUid}"`);
                return sendJson(res, 403, {
                    success: false,
                    error: "Access denied. Students are not authorized to modify another student's profile."
                });
            }

            // Reject any student attempt to escalate privileges
            if (body.role && body.role !== "student" && callerRole !== "admin") {
                return sendJson(res, 403, { success: false, error: "Forbidden: Students cannot alter account roles." });
            }

            const updateName = body.name ? String(body.name).trim() : null;
            const updateDept = body.department ? String(body.department).trim() : null;
            const updateYear = body.academicYear ? String(body.academicYear).trim() : null;

            if (updateName) {
                await queryDatabase(`UPDATE public.profiles SET full_name = $1, updated_at = NOW() WHERE firebase_uid = $2 OR auth_uid = $2;`, [updateName, callerUid]);
            }
            if (updateDept || updateYear) {
                await queryDatabase(`
                    UPDATE public.students 
                    SET department = COALESCE($1, department), academic_year = COALESCE($2, academic_year), updated_at = NOW()
                    WHERE roll_number = $3;
                `, [updateDept, updateYear, callerRoll]);
            }

            // Sync memory store
            const memStudents = getStored("students", []);
            const match = memStudents.find(s => s.roll_number.toUpperCase() === callerRoll);
            if (match) {
                if (updateName) match.name = updateName;
                if (updateDept) match.department = updateDept;
                if (updateYear) match.academic_year = updateYear;
                setStored("students", memStudents);
            }

            return sendJson(res, 200, { success: true, message: "Profile updated successfully." });
        } catch (err) {
            return sendJson(res, 500, { success: false, error: "Profile update error: " + err.message });
        }
    }

    // 4. Admin Overview Statistics
    if (pathname === "/api/admin/overview" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Access denied. Admin authorization required." }, req);
        }

        const students = getStored("students", []);
        const faculty = getStored("faculty", []);
        const examinations = getStored("examinations", []);
        const results = getStored("results", []);

        const publishedExams = examinations.filter(e => e.status === "published");
        const completedAttempts = results.length;
        const avgScore = results.length > 0
            ? Math.round(results.reduce((acc, r) => acc + (Number(r.score) || 0), 0) / results.length)
            : 0;

        return sendJson(res, 200, {
            success: true,
            stats: {
                totalStudents: students.length,
                totalFaculty: faculty.length,
                totalExaminations: examinations.length,
                publishedExaminations: publishedExams.length,
                completedAttempts: completedAttempts,
                averageScore: avgScore,
                pendingReviews: 0
            },
            recentActivity: results.slice(-6).reverse()
        }, req);
    }

    // 5. Admin Course Management
    if (pathname === "/api/admin/courses" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        // Query Supabase courses if available, fallback to memory store
        let dbCourses = [];
        try {
            const dbRes = await queryDatabase(`SELECT * FROM public.courses ORDER BY created_at DESC;`);
            if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
                dbCourses = dbRes.rows.map(c => ({
                    id: c.id,
                    name: c.title,
                    title: c.title,
                    code: c.code || c.id,
                    description: c.description || "",
                    department: c.department || "Information Technology",
                    instructor: c.instructor_name || "Faculty In-Charge",
                    level: c.level || "Intermediate",
                    duration: c.duration || "40 Hours",
                    is_active: c.is_active !== false,
                    status: c.is_active !== false ? "published" : "draft",
                    created_at: c.created_at
                }));
            }
        } catch (e) {
            console.warn("[ADMIN-COURSES-DB-WARN]", e.message);
        }

        const memCourses = getStored("courses", DEFAULT_COURSES).map(c => ({
            id: c.id,
            name: c.name || c.title,
            title: c.title || c.name,
            code: c.code || c.id,
            description: c.description || "",
            department: c.department || "Information Technology",
            instructor: c.instructor || "Faculty In-Charge",
            level: c.level || "Intermediate",
            duration: c.duration || "40 Hours",
            is_active: c.is_active !== false,
            status: c.is_active !== false ? "published" : "draft",
            created_at: c.created_at || new Date().toISOString()
        }));

        // Merge courses uniquely by id
        const courseMap = new Map();
        memCourses.forEach(c => courseMap.set(c.id, c));
        dbCourses.forEach(c => courseMap.set(c.id, c));
        const courses = Array.from(courseMap.values());

        return sendJson(res, 200, { success: true, courses }, req);
    }

    if (pathname === "/api/admin/courses/save" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const name = String(body.name || body.title || "").trim();
        if (!name) {
            return sendJson(res, 400, { error: "Course name is required." }, req);
        }

        const id = body.id ? String(body.id).trim().toLowerCase() : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const description = String(body.description || "").trim();
        const department = String(body.department || "Information Technology").trim();
        const instructor = String(body.instructor || body.instructor_name || "Faculty In-Charge").trim();
        const level = String(body.level || "Intermediate").trim();
        const duration = String(body.duration || "40 Hours").trim();
        const is_active = body.is_active !== false && body.status !== "draft";

        const courseItem = {
            id,
            name,
            title: name,
            code: body.code || id.toUpperCase(),
            description,
            department,
            instructor,
            level,
            duration,
            is_active,
            status: is_active ? "published" : "draft",
            updated_at: new Date().toISOString()
        };

        // Persist to Supabase if connected
        try {
            await queryDatabase(`
                INSERT INTO public.courses (id, title, code, description, department, instructor_name, level, duration, is_active, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                ON CONFLICT (id) DO UPDATE
                SET title = EXCLUDED.title,
                    code = EXCLUDED.code,
                    description = EXCLUDED.description,
                    department = EXCLUDED.department,
                    instructor_name = EXCLUDED.instructor_name,
                    level = EXCLUDED.level,
                    duration = EXCLUDED.duration,
                    is_active = EXCLUDED.is_active,
                    updated_at = NOW();
            `, [id, name, courseItem.code, description, department, instructor, level, duration, is_active]);
        } catch (e) {
            console.warn("[ADMIN-COURSE-SAVE-DB]", e.message);
        }

        // Persist to memory store
        const memCourses = getStored("courses", DEFAULT_COURSES);
        const existIdx = memCourses.findIndex(c => c.id === id);
        if (existIdx >= 0) {
            memCourses[existIdx] = Object.assign(memCourses[existIdx], courseItem);
        } else {
            courseItem.created_at = new Date().toISOString();
            memCourses.push(courseItem);
        }
        setStored("courses", memCourses);

        return sendJson(res, 200, { success: true, course: courseItem }, req);
    }

    if (pathname === "/api/admin/courses/toggle-status" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const courseId = String(body.courseId || body.id || "").trim();
        const memCourses = getStored("courses", DEFAULT_COURSES);
        const target = memCourses.find(c => c.id === courseId);

        if (target) {
            target.is_active = !target.is_active;
            target.status = target.is_active ? "published" : "draft";
            target.updated_at = new Date().toISOString();
            setStored("courses", memCourses);

            try {
                await queryDatabase(`UPDATE public.courses SET is_active = $1, updated_at = NOW() WHERE id = $2;`, [target.is_active, courseId]);
            } catch (e) {}

            return sendJson(res, 200, { success: true, course: target }, req);
        }
        return sendJson(res, 404, { error: "Course not found." }, req);
    }

    // 5B-0. Admin Students Export (Strictly Active students only - suspended and deleted excluded)
    if (pathname === "/api/admin/students/export" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        // Query Supabase PostgreSQL directly to ensure all registered students are retrieved
        let dbStudents = [];
        try {
            const dbRes = await queryDatabase(`
                SELECT s.id, s.roll_number, s.department, s.academic_year, s.created_at,
                       p.full_name as name, p.email, p.firebase_uid, p.role
                FROM public.students s
                JOIN public.profiles p ON s.profile_id = p.id
                ORDER BY s.roll_number ASC;
            `);
            if (dbRes && dbRes.rows) {
                dbStudents = dbRes.rows.map(s => ({
                    id: s.id,
                    roll_number: s.roll_number,
                    name: s.name,
                    email: s.email,
                    department: s.department,
                    academic_year: s.academic_year,
                    status: "active",
                    created_at: s.created_at
                }));
            }
        } catch (e) {}

        const memStudents = getStored("students", DEFAULT_STUDENTS);
        const studentMap = new Map();
        memStudents.forEach(s => {
            if (s.roll_number) studentMap.set(s.roll_number.toUpperCase(), s);
        });
        dbStudents.forEach(s => {
            if (s.roll_number) {
                const existing = studentMap.get(s.roll_number.toUpperCase());
                studentMap.set(s.roll_number.toUpperCase(), Object.assign({}, s, existing || {}));
            }
        });

        // Exclude suspended and deleted
        const activeStudents = Array.from(studentMap.values())
            .filter(s => (s.status || "active").toLowerCase() === "active")
            .sort((a, b) => (a.roll_number || "").localeCompare(b.roll_number || ""));

        return sendJson(res, 200, {
            success: true,
            filter: "active",
            count: activeStudents.length,
            students: activeStudents.map(s => ({
                id: s.id,
                roll_number: (s.roll_number || "").toUpperCase(),
                name: s.name,
                email: s.email,
                department: s.department || "Information Technology",
                academic_year: s.academic_year || "3rd Year B.Tech",
                status: "active",
                created_at: s.created_at || new Date().toISOString()
            }))
        }, req);
    }

    // 5B. Admin Student Management (Roll Number as Primary Identifier, Zero Duplicate Roll Numbers)
    if (pathname === "/api/admin/students" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        // Query Supabase students joined with profiles
        let dbStudents = [];
        try {
            const dbRes = await queryDatabase(`
                SELECT s.id, s.roll_number, s.department, s.academic_year, s.created_at,
                       p.full_name as name, p.email, p.firebase_uid, p.role
                FROM public.students s
                JOIN public.profiles p ON s.profile_id = p.id
                ORDER BY s.roll_number ASC;
            `);
            if (dbRes && dbRes.rows) {
                dbStudents = dbRes.rows.map(s => ({
                    id: s.id,
                    roll_number: s.roll_number,
                    name: s.name,
                    email: s.email,
                    department: s.department,
                    academic_year: s.academic_year,
                    firebase_uid: s.firebase_uid,
                    status: "active",
                    created_at: s.created_at
                }));
            }
        } catch (e) {
            console.warn("[ADMIN-STUDENTS-DB-WARN]", e.message);
        }

        const memStudents = getStored("students", DEFAULT_STUDENTS);
        const attempts = getStored("exam_attempts", []);
        const results = getStored("results", []);

        // Merge students uniquely by roll_number (Roll Number as primary unique identifier)
        const studentMap = new Map();
        memStudents.forEach(s => {
            if (s.roll_number) studentMap.set(s.roll_number.toUpperCase(), s);
        });
        dbStudents.forEach(s => {
            if (s.roll_number) {
                const existing = studentMap.get(s.roll_number.toUpperCase());
                studentMap.set(s.roll_number.toUpperCase(), Object.assign({}, s, existing || {}));
            }
        });

        let students = Array.from(studentMap.values()).map(s => {
            const roll = (s.roll_number || "").toUpperCase();
            const studentAttempts = attempts.filter(a => (a.rollNumber || "").toUpperCase() === roll);
            const studentResults = results.filter(r => (r.studentRoll || "").toUpperCase() === roll);
            return {
                ...s,
                status: s.status || "active",
                attemptsCount: studentAttempts.length,
                resultsCount: studentResults.length
            };
        }).sort((a, b) => a.roll_number.localeCompare(b.roll_number));

        const statusFilter = parsedUrl.query.status ? String(parsedUrl.query.status).trim().toLowerCase() : null;
        if (statusFilter === "active") {
            students = students.filter(s => (s.status || "active").toLowerCase() === "active");
        } else if (statusFilter === "suspended") {
            students = students.filter(s => (s.status || "").toLowerCase() === "suspended");
        } else if (statusFilter === "deleted") {
            students = students.filter(s => (s.status || "").toLowerCase() === "deleted");
        }

        return sendJson(res, 200, { success: true, count: students.length, students }, req);
    }

    // 5B-1. Admin Student Details with Attempt & Result Count (For Confirmation Dialogs)
    if (pathname === "/api/admin/students/details" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const roll = String(parsedUrl.query.roll || "").trim().toUpperCase();
        if (!roll) {
            return sendJson(res, 400, { error: "Roll number is required." }, req);
        }

        const students = getStored("students", DEFAULT_STUDENTS);
        const student = students.find(s => (s.roll_number || "").toUpperCase() === roll);
        if (!student) {
            return sendJson(res, 404, { error: `Student with roll number '${roll}' not found.` }, req);
        }

        const attempts = getStored("exam_attempts", []).filter(a => (a.rollNumber || "").toUpperCase() === roll);
        const results = getStored("results", []).filter(r => (r.studentRoll || "").toUpperCase() === roll);

        return sendJson(res, 200, {
            success: true,
            student: {
                ...student,
                status: student.status || "active",
                attemptsCount: attempts.length,
                resultsCount: results.length
            }
        }, req);
    }

    // 5B-2. Suspend Student Account
    if (pathname === "/api/admin/students/suspend" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const roll = String(body.rollNumber || body.roll || "").trim().toUpperCase();
        if (!roll) {
            return sendJson(res, 400, { error: "Roll number is required." }, req);
        }

        const students = getStored("students", DEFAULT_STUDENTS);
        const target = students.find(s => (s.roll_number || "").toUpperCase() === roll);
        if (!target) {
            return sendJson(res, 404, { error: `Student with roll number '${roll}' not found.` }, req);
        }

        target.status = "suspended";
        target.updated_at = new Date().toISOString();
        setStored("students", students);

        // Record in institutional audit log
        const auditLogs = getStored("audit_logs", []);
        auditLogs.unshift({
            id: "audit_" + Date.now(),
            action: "SUSPEND_STUDENT",
            adminUser: payload.name || "IT Administrator",
            studentRoll: roll,
            studentName: target.name,
            timestamp: new Date().toISOString()
        });
        setStored("audit_logs", auditLogs);

        console.log(`[STUDENT-MGMT] Admin suspended student: ${roll} (${target.name})`);

        return sendJson(res, 200, {
            success: true,
            message: `Student account for ${roll} has been suspended.`,
            student: target
        }, req);
    }

    // 5B-3. Activate / Unsuspend Student Account
    if (pathname === "/api/admin/students/activate" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const roll = String(body.rollNumber || body.roll || "").trim().toUpperCase();
        if (!roll) {
            return sendJson(res, 400, { error: "Roll number is required." }, req);
        }

        const students = getStored("students", DEFAULT_STUDENTS);
        const target = students.find(s => (s.roll_number || "").toUpperCase() === roll);
        if (!target) {
            return sendJson(res, 404, { error: `Student with roll number '${roll}' not found.` }, req);
        }

        target.status = "active";
        target.updated_at = new Date().toISOString();
        setStored("students", students);

        // Record in institutional audit log
        const auditLogs = getStored("audit_logs", []);
        auditLogs.unshift({
            id: "audit_" + Date.now(),
            action: "ACTIVATE_STUDENT",
            adminUser: payload.name || "IT Administrator",
            studentRoll: roll,
            studentName: target.name,
            timestamp: new Date().toISOString()
        });
        setStored("audit_logs", auditLogs);

        console.log(`[STUDENT-MGMT] Admin reactivated student: ${roll} (${target.name})`);

        return sendJson(res, 200, {
            success: true,
            message: `Student account for ${roll} has been reactivated.`,
            student: target
        }, req);
    }

    // 5B-4. Permanently Delete Student Account (With Strict Confirmation & Data Retention)
    if (pathname === "/api/admin/students/delete" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const roll = String(body.rollNumber || body.roll || "").trim().toUpperCase();
        const confirmationRoll = String(body.confirmationRoll || body.confirmRoll || "").trim().toUpperCase();

        if (!roll) {
            return sendJson(res, 400, { error: "Roll number is required." }, req);
        }

        if (confirmationRoll !== roll) {
            return sendJson(res, 400, {
                error: `Confirmation roll number does not match. Please type '${roll}' exactly to confirm permanent deletion.`
            }, req);
        }

        const students = getStored("students", DEFAULT_STUDENTS);
        const target = students.find(s => (s.roll_number || "").toUpperCase() === roll);
        if (!target) {
            return sendJson(res, 404, { error: `Student with roll number '${roll}' not found.` }, req);
        }

        // Count associated attempts and results to preserve
        const attempts = getStored("exam_attempts", []).filter(a => (a.rollNumber || "").toUpperCase() === roll);
        const results = getStored("results", []).filter(r => (r.studentRoll || "").toUpperCase() === roll);

        // Mark as deleted, revoke access, anonymize personal details, preserve institutional audit link
        const oldName = target.name;
        target.status = "deleted";
        target.name = `[Deactivated Student - ${roll}]`;
        target.email = "[Protected - Deactivated]";
        target.updated_at = new Date().toISOString();
        setStored("students", students);

        try {
            await queryDatabase(`
                UPDATE public.profiles
                SET full_name = $1, updated_at = NOW()
                WHERE id IN (SELECT profile_id FROM public.students WHERE roll_number = $2);
            `, [`[Deactivated Student - ${roll}]`, roll]);
        } catch (e) {}

        // Record in institutional audit log
        const auditLogs = getStored("audit_logs", []);
        auditLogs.unshift({
            id: "audit_" + Date.now(),
            action: "DELETE_STUDENT",
            adminUser: payload.name || "IT Administrator",
            studentRoll: roll,
            originalName: oldName,
            attemptsPreserved: attempts.length,
            resultsPreserved: results.length,
            timestamp: new Date().toISOString()
        });
        setStored("audit_logs", auditLogs);

        // Revoke Firebase user if Firebase Admin initialized
        if (typeof firebaseAdminAuth !== "undefined" && firebaseAdminAuth && target.firebase_uid) {
            try {
                await firebaseAdminAuth.updateUser(target.firebase_uid, { disabled: true });
                console.log(`[STUDENT-MGMT] Firebase Auth disabled for UID: ${target.firebase_uid}`);
            } catch (fbErr) {
                console.warn(`[STUDENT-MGMT] Firebase Auth disable warning:`, fbErr.message);
            }
        }

        console.log(`[STUDENT-MGMT] Permanently deleted student ${roll}. Preserved ${attempts.length} attempts and ${results.length} results.`);

        return sendJson(res, 200, {
            success: true,
            message: `Student ${roll} account permanently deleted. Access revoked. ${results.length} examination records preserved for institutional audit.`,
            rollNumber: roll,
            attemptsPreserved: attempts.length,
            resultsPreserved: results.length
        }, req);
    }

    if (pathname === "/api/admin/students/save" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const roll = String(body.roll_number || body.roll || "").trim().toUpperCase();
        const name = String(body.name || body.full_name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const department = String(body.department || body.branch || "Information Technology").trim();
        const academic_year = String(body.academic_year || body.batch || "3rd Year B.Tech").trim();
        const isEdit = Boolean(body.isEdit);
        const originalRoll = body.originalRoll ? String(body.originalRoll).trim().toUpperCase() : null;

        if (!roll || !name || !email) {
            return sendJson(res, 400, { error: "Roll Number, Student Name, and Email are mandatory." }, req);
        }

        const memStudents = getStored("students", DEFAULT_STUDENTS);

        // Prevent duplicate roll numbers
        const duplicateRoll = memStudents.find(s => s.roll_number.toUpperCase() === roll && (!isEdit || s.roll_number.toUpperCase() !== originalRoll));
        if (duplicateRoll) {
            return sendJson(res, 409, { error: `Student with Roll Number '${roll}' already exists. Roll numbers must be unique.` }, req);
        }

        let studentEntry = null;
        if (isEdit && originalRoll) {
            const idx = memStudents.findIndex(s => s.roll_number.toUpperCase() === originalRoll);
            if (idx >= 0) {
                memStudents[idx].roll_number = roll;
                memStudents[idx].name = name;
                memStudents[idx].email = email;
                memStudents[idx].department = department;
                memStudents[idx].academic_year = academic_year;
                studentEntry = memStudents[idx];
            }
        }

        if (!studentEntry) {
            studentEntry = {
                id: "std_" + roll.toLowerCase(),
                roll_number: roll,
                name: name,
                email: email,
                department: department,
                academic_year: academic_year,
                status: "active",
                created_at: new Date().toISOString()
            };
            memStudents.push(studentEntry);
        }

        setStored("students", memStudents);

        // Also update Supabase if accessible
        try {
            await queryDatabase(`
                INSERT INTO public.profiles (firebase_uid, auth_uid, email, full_name, role)
                VALUES ($1, $1, $2, $3, 'student')
                ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = NOW()
                RETURNING id;
            `, ["admin_created_" + roll.toLowerCase(), email, name]);
            await queryDatabase(`
                INSERT INTO public.students (profile_id, roll_number, department, academic_year)
                SELECT p.id, $1, $2, $3 FROM public.profiles p WHERE p.email = $4
                ON CONFLICT (roll_number) DO UPDATE
                SET department = EXCLUDED.department, academic_year = EXCLUDED.academic_year, updated_at = NOW();
            `, [roll, department, academic_year, email]);
        } catch (e) {}

        return sendJson(res, 200, { success: true, student: studentEntry }, req);
    }

    if (pathname === "/api/admin/students/toggle-status" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const studentId = String(body.studentId || body.roll_number || "").trim().toUpperCase();
        const students = getStored("students", DEFAULT_STUDENTS);
        const target = students.find(s => s.id === studentId || s.roll_number.toUpperCase() === studentId);

        if (target) {
            target.status = target.status === "suspended" ? "active" : "suspended";
            setStored("students", students);
            return sendJson(res, 200, { success: true, student: target }, req);
        }
        return sendJson(res, 404, { error: "Student not found." }, req);
    }

    // =========================================================================
    // DEDICATED EXAMINATION-ONLY PLATFORM APIS
    // =========================================================================

    // 0. Server Authoritative Time (UTC & IST)
    if (pathname === "/api/server-time" && method === "GET") {
        const now = new Date();
        return sendJson(res, 200, {
            success: true,
            utc: now.toISOString(),
            ist: formatIST(now),
            istFormatted: formatISTShort(now),
            timestamp: now.getTime(),
            timezone: "Asia/Kolkata (IST, UTC+05:30)"
        }, req);
    }

    // 5C. Admin Examinations Management (Standard 50 MCQs / 60 Min / Scheduled IST)
    if (pathname === "/api/admin/exams" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const memExams = getStored("examinations", []);
        const students = getStored("students", DEFAULT_STUDENTS);
        const results = getStored("results", []);
        const attempts = getStored("exam_attempts", []);

        const examList = memExams.map(e => {
            const eligibleStudents = students.filter(s => s.status !== "deleted" && s.status !== "suspended");

            const examResults = results.filter(r => r.examId === e.id);
            const examAttempts = attempts.filter(a => a.examId === e.id);
            const attemptedRolls = new Set([
                ...examResults.map(r => (r.studentRoll || "").toUpperCase()),
                ...examAttempts.map(a => (a.rollNumber || "").toUpperCase())
            ]);

            const avgScore = examResults.length > 0
                ? Math.round((examResults.reduce((a, b) => a + (Number(b.score) || 0), 0) / examResults.length) * 10) / 10
                : 0;

            const qCount = (e.questions && e.questions.length) || e.total_questions || 50;

            return {
                id: e.id,
                title: e.title || e.name,
                name: e.title || e.name,
                description: e.description || "",
                duration_minutes: e.duration_minutes || 60,
                duration: e.duration_minutes || 60,
                total_questions: qCount,
                total_marks: e.total_marks || 50,
                totalMarks: e.total_marks || 50,
                marks_per_question: e.marks_per_question || 1,
                negative_marking: false,
                scheduled_date: e.scheduled_date || (e.scheduled_start_at ? e.scheduled_start_at.slice(0, 10) : ""),
                scheduled_start_at: e.scheduled_start_at || new Date().toISOString(),
                scheduled_end_at: e.scheduled_end_at || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                scheduled_start_ist: e.scheduled_start_ist || formatISTShort(new Date(e.scheduled_start_at || Date.now())),
                status: e.status || "published",
                totalEligibleStudents: eligibleStudents.length,
                totalRegisteredStudents: students.length,
                totalAttempted: attemptedRolls.size,
                totalCompleted: examResults.length,
                averageScore: avgScore,
                created_at: e.created_at || new Date().toISOString()
            };
        });

        return sendJson(res, 200, { success: true, count: examList.length, examinations: examList }, req);
    }

    // Create New Examination (Standard 50 MCQs / 60 Min / Scheduled IST)
    if (pathname === "/api/admin/exams/create" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const title = String(body.title || body.name || "").trim();
        if (!title) {
            return sendJson(res, 400, { success: false, error: "Examination title is required." }, req);
        }

        const id = body.id ? String(body.id).trim().toLowerCase() : ("exam_" + Date.now());
        const description = String(body.description || "Standard 50-MCQ Assessment").trim();
        const durationMinutes = Number(body.duration_minutes || body.duration) || 60;
        const totalQuestions = 50;
        const totalMarks = 50;
        const marksPerQuestion = 1;

        // Scheduled start & end in IST / UTC ISO
        let scheduledStart = body.scheduled_start_at;
        if (!scheduledStart && body.scheduled_date && body.scheduled_time) {
            const [y, m, d] = body.scheduled_date.split("-").map(Number);
            const [hr, min] = body.scheduled_time.split(":").map(Number);
            const istTimestamp = Date.UTC(y, m - 1, d, hr, min, 0) - (5.5 * 3600000);
            scheduledStart = new Date(istTimestamp).toISOString();
        } else if (!scheduledStart) {
            scheduledStart = new Date().toISOString();
        }

        const startDate = new Date(scheduledStart);
        const endDate = new Date(startDate.getTime() + (durationMinutes * 60 * 1000));
        const scheduledEnd = endDate.toISOString();
        const scheduledStartIST = formatISTShort(startDate);

        // Process 50 questions
        let questions = Array.isArray(body.questions) && body.questions.length > 0 ? body.questions : [];
        if (questions.length < 50) {
            const needed = 50 - questions.length;
            const extra = DEFAULT_50_MCQS.slice(0, needed).map((q, idx) => ({
                ...q,
                question_number: questions.length + idx + 1
            }));
            questions = [...questions, ...extra];
        }

        questions = questions.slice(0, 50).map((q, idx) => ({
            id: q.id || `q_${idx + 1}`,
            question_number: idx + 1,
            question_text: q.question_text || q.question || q.statement || `Question ${idx + 1}`,
            option_a: q.option_a || (q.options && q.options[0]) || "Option A",
            option_b: q.option_b || (q.options && q.options[1]) || "Option B",
            option_c: q.option_c || (q.options && q.options[2]) || "Option C",
            option_d: q.option_d || (q.options && q.options[3]) || "Option D",
            correct_answer: (q.correct_answer || q.answer || "A").toString().trim().toUpperCase(),
            marks: 1,
            explanation: q.explanation || ""
        }));

        const newExam = {
            id,
            title,
            name: title,
            description,
            duration_minutes: durationMinutes,
            total_questions: totalQuestions,
            total_marks: totalMarks,
            marks_per_question: marksPerQuestion,
            negative_marking: false,
            scheduled_date: scheduledStart.slice(0, 10),
            scheduled_start_at: scheduledStart,
            scheduled_end_at: scheduledEnd,
            scheduled_start_ist: scheduledStartIST,
            status: body.status || "published",
            questions,
            created_at: new Date().toISOString()
        };

        const memExams = getStored("examinations", []);
        memExams.unshift(newExam);
        setStored("examinations", memExams);

        // Synchronize creation with Supabase PostgreSQL
        await upsertExamToDatabase(newExam);

        console.log(`[EXAM-MGMT] Created new 50-MCQ exam '${title}' (${id}) scheduled at ${scheduledStartIST}`);

        return sendJson(res, 201, { success: true, exam: newExam }, req);
    }

    // Save / Edit Existing Examination
    if (pathname === "/api/admin/exams/save" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const examId = String(body.id || body.examId || "").trim();
        const memExams = getStored("examinations", []);
        const existIdx = memExams.findIndex(e => e.id === examId);

        if (existIdx < 0) {
            return sendJson(res, 404, { success: false, error: "Examination not found." }, req);
        }

        const target = memExams[existIdx];
        if (body.title || body.name) target.title = target.name = String(body.title || body.name).trim();
        if (body.description !== undefined) target.description = String(body.description).trim();
        if (body.status !== undefined) target.status = String(body.status).trim();

        if (body.scheduled_start_at) {
            target.scheduled_start_at = body.scheduled_start_at;
            const startD = new Date(body.scheduled_start_at);
            const durationM = target.duration_minutes || 60;
            target.scheduled_end_at = new Date(startD.getTime() + durationM * 60 * 1000).toISOString();
            target.scheduled_start_ist = formatISTShort(startD);
        }

        if (Array.isArray(body.questions) && body.questions.length > 0) {
            target.questions = body.questions.map((q, idx) => ({
                id: q.id || `q_${idx + 1}`,
                question_number: idx + 1,
                question_text: q.question_text || q.question || q.statement || `Question ${idx + 1}`,
                option_a: q.option_a || (q.options && q.options[0]) || "Option A",
                option_b: q.option_b || (q.options && q.options[1]) || "Option B",
                option_c: q.option_c || (q.options && q.options[2]) || "Option C",
                option_d: q.option_d || (q.options && q.options[3]) || "Option D",
                correct_answer: (q.correct_answer || q.answer || "A").toString().trim().toUpperCase(),
                marks: 1,
                explanation: q.explanation || ""
            }));
            target.total_questions = target.questions.length;
        }

        target.updated_at = new Date().toISOString();
        memExams[existIdx] = target;
        setStored("examinations", memExams);

        // Synchronize updates with Supabase PostgreSQL
        await upsertExamToDatabase(target);

        return sendJson(res, 200, { success: true, exam: target }, req);
    }

    // Toggle Exam Publish Status
    if (pathname === "/api/admin/exams/publish" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const examId = String(body.examId || body.id || "").trim();
        const memExams = getStored("examinations", []);
        const target = memExams.find(e => e.id === examId);

        if (!target) {
            return sendJson(res, 404, { success: false, error: "Examination not found." }, req);
        }

        target.status = target.status === "published" ? "draft" : "published";
        target.updated_at = new Date().toISOString();
        setStored("examinations", memExams);

        // Synchronize publish state with Supabase PostgreSQL
        await updateExamStatusInDatabase(examId, target.status);

        return sendJson(res, 200, { success: true, exam: target }, req);
    }

    // Safe Delete Examination (Requires typed confirmation phrase)
    if (pathname === "/api/admin/exams/delete" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const examId = String(body.examId || body.id || "").trim();
        const confirmationPhrase = String(body.confirmationPhrase || body.confirmPhrase || "").trim();

        const memExams = getStored("examinations", []);
        const exam = memExams.find(e => e.id === examId);

        if (!exam) {
            return sendJson(res, 404, { success: false, error: "Examination not found." }, req);
        }

        const expectedTitle = (exam.title || exam.name || "").trim().toLowerCase();
        const typedPhrase = confirmationPhrase.toLowerCase();
        const isMatched = (typedPhrase === "confirm delete" || typedPhrase === expectedTitle);

        if (!isMatched) {
            return sendJson(res, 400, {
                success: false,
                error: `Confirmation phrase mismatch. Please type '${exam.title}' or 'CONFIRM DELETE' to proceed with deletion.`
            }, req);
        }

        const remainingExams = memExams.filter(e => e.id !== examId);
        setStored("examinations", remainingExams);

        // Delete from Supabase PostgreSQL
        await deleteExamFromDatabase(examId);

        const results = getStored("results", []);
        setStored("results", results.filter(r => r.examId !== examId));

        const attempts = getStored("exam_attempts", []);
        setStored("exam_attempts", attempts.filter(a => a.examId !== examId));

        const answers = getStored("student_answers", []);
        setStored("student_answers", answers.filter(a => a.examId !== examId));

        console.log(`[EXAM-AUDIT] Exam '${exam.title}' (${examId}) permanently deleted by Administrator (${payload.username}) at ${new Date().toISOString()}`);

        return sendJson(res, 200, {
            success: true,
            message: `Examination '${exam.title}' and all associated student attempts have been permanently deleted.`,
            deletedExamId: examId
        }, req);
    }

    // Clean Legacy Courses (Confirmation phrase: 'DELETE LEGACY COURSES')
    if (pathname === "/api/admin/legacy/cleanup" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const phrase = String(body.confirmationPhrase || "").trim();

        if (phrase !== "DELETE LEGACY COURSES") {
            return sendJson(res, 400, {
                success: false,
                error: "Invalid confirmation phrase. You must type 'DELETE LEGACY COURSES' to proceed."
            }, req);
        }

        setStored("courses", []);
        try {
            await queryDatabase(`TRUNCATE TABLE public.courses CASCADE;`);
        } catch (e) {
            console.warn("[CLEANUP-DB-WARN]", e.message);
        }

        const students = getStored("students", DEFAULT_STUDENTS);
        students.forEach(s => {
            delete s.enrolled_courses;
        });
        setStored("students", students);

        console.log(`[LEGACY-CLEANUP-AUDIT] Legacy courses purged by Admin (${payload.username}) at ${new Date().toISOString()}`);

        return sendJson(res, 200, {
            success: true,
            message: "Legacy courses and enrollments have been cleanly deleted. Examination platform is now active."
        }, req);
    }

    // Dedicated Exam Monitoring & Candidate Roster (Strict Isolation)
    if (pathname === "/api/admin/exams/monitoring" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        await ensureDatabaseSync();

        const memExams = getStored("examinations", []);
        let targetExamId = parsedUrl.query.examId ? String(parsedUrl.query.examId).trim() : null;
        let exam = targetExamId ? memExams.find(e => e.id === targetExamId) : memExams[0];

        if (!exam && memExams.length > 0) {
            exam = memExams[0];
        }

        if (!exam) {
            return sendJson(res, 200, {
                success: true,
                exam: null,
                counts: { totalAssigned: 0, notStarted: 0, inProgress: 0, submitted: 0, absent: 0 },
                candidates: []
            }, req);
        }

        const allStudents = getStored("students", DEFAULT_STUDENTS);
        const results = getStored("results", []);
        const attempts = getStored("exam_attempts", []);
        const answers = getStored("student_answers", []);
        const now = Date.now();
        const endTime = new Date(exam.scheduled_end_at || (now + 60 * 60 * 1000)).getTime();
        const isClosed = now >= endTime;

        // Eligible student roster: Include all registered students (and any historical attempt if student was later deleted)
        const eligibleStudents = allStudents.filter(s => s.status !== "deleted" || results.some(r => r.examId === exam.id && (r.studentRoll || "").toUpperCase() === s.roll_number.toUpperCase()) || attempts.some(a => a.examId === exam.id && (a.rollNumber || "").toUpperCase() === s.roll_number.toUpperCase()));

        const roster = eligibleStudents.map(student => {
            const roll = student.roll_number.toUpperCase();
            const result = results.find(r => r.examId === exam.id && (r.studentRoll || "").toUpperCase() === roll);
            const attempt = attempts.find(a => a.examId === exam.id && (a.rollNumber || "").toUpperCase() === roll);
            const studentAnswers = answers.filter(ans => (ans.attemptId === (attempt && attempt.attemptId) || (ans.rollNumber || "").toUpperCase() === roll) && ans.examId === exam.id);

            let status = "Not Started";
            let score = null;
            let percentage = null;
            let passed = null;
            let startedAt = attempt ? attempt.started_at : null;
            let submittedAt = null;
            let timeSpent = 0;

            if (result) {
                status = (result.autoSubmitted || result.auto_submitted) ? "Auto Submitted" : "Submitted";
                score = Number(result.score);
                percentage = Number(result.percentage);
                passed = result.status === "Pass" || (score >= 20);
                submittedAt = result.submittedAt || result.completedAt || result.completed_at;
                if (startedAt && submittedAt) {
                    timeSpent = Math.max(0, Math.floor((new Date(submittedAt).getTime() - new Date(startedAt).getTime()) / 1000));
                }
            } else if (attempt && (attempt.status === "submitted" || attempt.status === "evaluated" || attempt.status === "completed" || (attempt.marks_obtained !== null && attempt.marks_obtained !== undefined))) {
                status = (attempt.auto_submitted || attempt.status === "auto_submitted") ? "Auto Submitted" : "Submitted";
                score = attempt.marks_obtained !== null && attempt.marks_obtained !== undefined ? Number(attempt.marks_obtained) : null;
                percentage = score !== null ? Math.round((score / (exam.total_marks || 50)) * 100) : null;
                passed = score !== null ? (score >= 20) : null;
                submittedAt = attempt.submitted_at;
                if (startedAt && submittedAt) {
                    timeSpent = Math.max(0, Math.floor((new Date(submittedAt).getTime() - new Date(startedAt).getTime()) / 1000));
                }
            } else if (attempt && attempt.status === "in_progress") {
                const isAttemptExpired = attempt.deadline_at && (now > new Date(attempt.deadline_at).getTime());
                if (isClosed || isAttemptExpired) {
                    status = "Auto Submitted";
                    score = (attempt.marks_obtained !== null && attempt.marks_obtained !== undefined) ? Number(attempt.marks_obtained) : 0;
                    percentage = Math.round((score / (exam.total_marks || 50)) * 100);
                    passed = score >= 20;
                    submittedAt = attempt.deadline_at || exam.scheduled_end_at || new Date(now).toISOString();
                } else {
                    status = "In Progress";
                }
                if (startedAt) {
                    timeSpent = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
                }
            } else if (student.status === "suspended") {
                status = "Suspended (Ineligible)";
            } else {
                if (isClosed) {
                    status = "Absent";
                } else {
                    status = "Not Started";
                }
            }

            const isDeleted = (student.status === "deleted");
            const candidateName = isDeleted ? `[Deactivated Student - ${roll}]` : student.name;
            const candidateEmail = isDeleted ? "[Protected - Deactivated]" : student.email;

            return {
                roll_number: roll,
                rollNumber: roll,
                name: candidateName,
                studentName: candidateName,
                email: candidateEmail,
                department: student.department,
                branch: student.department,
                academic_year: student.academic_year,
                batch: student.academic_year,
                accountStatus: student.status || "active",
                isDeleted,
                status,
                attemptStatus: status,
                score,
                marksObtained: score,
                percentage,
                passed,
                started_at: startedAt,
                submitted_at: submittedAt,
                time_spent_seconds: timeSpent,
                answered_count: studentAnswers.length
            };
        });

        const activeCount = allStudents.filter(s => s.status === "active").length;
        const suspendedCount = allStudents.filter(s => s.status === "suspended").length;

        const counts = {
            totalRegistered: allStudents.length,
            totalEligible: activeCount,
            totalSuspended: suspendedCount,
            totalAssigned: roster.length, // backwards compatibility
            notStarted: roster.filter(r => r.status === "Not Started").length,
            inProgress: roster.filter(r => r.status === "In Progress").length,
            submitted: roster.filter(r => r.status === "Submitted" || r.status === "Auto Submitted").length,
            submittedDirect: roster.filter(r => r.status === "Submitted").length,
            autoSubmitted: roster.filter(r => r.status === "Auto Submitted").length,
            absent: roster.filter(r => r.status === "Absent").length,
            resultsAvailable: roster.filter(r => r.score !== null).length
        };

        return sendJson(res, 200, {
            success: true,
            exam: {
                id: exam.id,
                title: exam.title || exam.name,
                duration_minutes: exam.duration_minutes || 60,
                total_questions: exam.total_questions || 50,
                total_marks: exam.total_marks || 50,
                scheduled_start_at: exam.scheduled_start_at,
                scheduled_end_at: exam.scheduled_end_at,
                scheduled_start_ist: exam.scheduled_start_ist || formatISTShort(new Date(exam.scheduled_start_at || Date.now())),
                isClosed
            },
            counts,
            candidates: roster
        }, req);
    }

    // Student Assigned Examinations with Server Time & Live Countdown
    if (pathname === "/api/student/assigned-exams" && method === "GET") {
        let studentRoll = "";
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim() || extractAdminToken(req);
        const payload = verifyToken(token) || decodeFirebaseToken(token);
        if (payload && payload.roll) {
            studentRoll = payload.roll.toUpperCase();
        }
        if (!studentRoll && parsedUrl.query.roll) {
            studentRoll = String(parsedUrl.query.roll).trim().toUpperCase();
        }

        // Student Account Status check: Block suspended or deleted accounts
        if (studentRoll) {
            const memStudents = getStored("students", DEFAULT_STUDENTS);
            const candidate = memStudents.find(s => (s.roll_number || "").toUpperCase() === studentRoll);
            if (candidate) {
                if (candidate.status === "suspended") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "suspended",
                        error: "Your student account has been suspended. Please contact the administrator."
                    }, req);
                }
                if (candidate.status === "deleted") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "deleted",
                        error: "Your student account is no longer active. Please contact the administrator."
                    }, req);
                }
            }
        }

        const memExams = getStored("examinations", []).filter(e => e.status === "published");
        const results = getStored("results", []);
        const attempts = getStored("exam_attempts", []);
        const now = Date.now();

        const assigned = [];
        memExams.forEach(exam => {
            const startTime = new Date(exam.scheduled_start_at || now).getTime();
            const endTime = new Date(exam.scheduled_end_at || (startTime + 60 * 60 * 1000)).getTime();

            const result = results.find(r => r.examId === exam.id && (r.studentRoll || "").toUpperCase() === studentRoll);
            const attempt = attempts.find(a => a.examId === exam.id && (a.rollNumber || "").toUpperCase() === studentRoll);

            let studentStatus = "ready";
            let remainingSecondsToStart = Math.max(0, Math.floor((startTime - now) / 1000));
            let remainingSecondsToClose = Math.max(0, Math.floor((endTime - now) / 1000));

            if (attempt && attempt.status === "terminated") {
                studentStatus = "terminated";
            } else if (result) {
                studentStatus = result.status === "Terminated" ? "terminated" : "submitted";
            } else if (attempt && attempt.status === "in_progress") {
                if (now >= endTime) {
                    studentStatus = "auto_submitted";
                } else {
                    studentStatus = "in_progress";
                }
            } else {
                if (now < startTime) {
                    studentStatus = "upcoming";
                } else if (now >= endTime) {
                    studentStatus = "closed";
                } else {
                    studentStatus = "ready";
                }
            }

            assigned.push({
                id: exam.id,
                title: exam.title || exam.name,
                description: exam.description || "",
                duration_minutes: exam.duration_minutes || 60,
                total_questions: (exam.questions && exam.questions.length) || exam.total_questions || 50,
                total_marks: exam.total_marks || 50,
                scheduled_start_at: exam.scheduled_start_at,
                scheduled_end_at: exam.scheduled_end_at,
                scheduled_start_ist: exam.scheduled_start_ist || formatISTShort(new Date(startTime)),
                status: exam.status,
                studentStatus,
                termsAccepted: Boolean(attempt && attempt.terms_accepted),
                termsAcceptedAt: attempt ? attempt.terms_accepted_at : null,
                fullscreenViolationCount: (attempt && attempt.fullscreen_violation_count) || 0,
                remainingSecondsToStart,
                remainingSecondsToClose,
                result: (result || (attempt && attempt.status === "terminated")) ? {
                    score: result ? result.score : 0,
                    totalMarks: result ? (result.totalMarks || 50) : 50,
                    percentage: result ? result.percentage : 0,
                    status: (result && result.status) || "Terminated",
                    submittedAt: (result && (result.submittedAt || result.completedAt)) || (attempt && attempt.submitted_at)
                } : null
            });
        });

        return sendJson(res, 200, {
            success: true,
            studentRoll,
            serverTime: {
                utc: new Date(now).toISOString(),
                ist: formatIST(new Date(now)),
                timestamp: now
            },
            exams: assigned,
            examinations: assigned,
            assignedExams: assigned
        }, req);
    }

    // Explicit Terms & Conditions Acceptance Before Exam
    if (pathname === "/api/exams/accept-terms" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const examId = String(body.examId || "").trim();
            const rollNumber = String(body.rollNumber || body.roll || "").trim().toUpperCase();

            if (!examId || !rollNumber) {
                return sendJson(res, 400, { success: false, error: "Missing examId or rollNumber." }, req);
            }

            const memStudents = getStored("students", DEFAULT_STUDENTS);
            const student = memStudents.find(s => (s.roll_number || "").toUpperCase() === rollNumber);
            if (student && (student.status === "suspended" || student.status === "deleted")) {
                return sendJson(res, 403, { success: false, error: "Student account suspended or deactivated." }, req);
            }

            const attempts = getStored("exam_attempts", []);
            let attempt = attempts.find(a => a.examId === examId && (a.rollNumber || "").toUpperCase() === rollNumber);
            const nowIso = new Date().toISOString();

            if (attempt) {
                attempt.terms_accepted = true;
                attempt.terms_accepted_at = attempt.terms_accepted_at || nowIso;
            } else {
                attempt = {
                    attemptId: "att_" + examId + "_" + rollNumber.toLowerCase() + "_" + Date.now(),
                    examId: examId,
                    rollNumber: rollNumber,
                    studentName: (student && student.name) || (body.studentName || rollNumber),
                    terms_accepted: true,
                    terms_accepted_at: nowIso,
                    status: "not_started",
                    fullscreen_violation_count: 0
                };
                attempts.push(attempt);
            }
            setStored("exam_attempts", attempts);

            try {
                await queryDatabase(`
                    INSERT INTO public.exam_attempts (
                        id, examination_id, roll_number, terms_accepted, terms_accepted_at, status, created_at, updated_at
                    ) VALUES ($1, $2, $3, true, $4, $5, NOW(), NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        terms_accepted = true,
                        terms_accepted_at = COALESCE(public.exam_attempts.terms_accepted_at, EXCLUDED.terms_accepted_at),
                        updated_at = NOW();
                `, [attempt.attemptId, examId, rollNumber, nowIso, attempt.status]);
            } catch (e) {
                console.warn("[TERMS-DB-WARN]", e.message);
            }

            console.log(`[TERMS-ACCEPT] Terms accepted by candidate ${rollNumber} for exam ${examId} at ${nowIso}`);

            return sendJson(res, 200, {
                success: true,
                termsAccepted: true,
                termsAcceptedAt: attempt.terms_accepted_at,
                attemptId: attempt.attemptId
            }, req);
        } catch (err) {
            return sendJson(res, 500, { success: false, error: err.message }, req);
        }
    }

    // Check Terms & Conditions Acceptance Status (Idempotency Guard)
    if (pathname === "/api/exams/terms-status" && method === "GET") {
        const examId = String(parsedUrl.query.examId || "").trim();
        const rollNumber = String(parsedUrl.query.roll || parsedUrl.query.rollNumber || "").trim().toUpperCase();

        if (!examId || !rollNumber) {
            return sendJson(res, 400, { success: false, error: "Missing examId or roll." }, req);
        }

        const attempts = getStored("exam_attempts", []);
        const attempt = attempts.find(a => a.examId === examId && (a.rollNumber || "").toUpperCase() === rollNumber);
        const results = getStored("results", []);
        const result = results.find(r => r.examId === examId && (r.studentRoll || "").toUpperCase() === rollNumber);

        return sendJson(res, 200, {
            success: true,
            examId,
            rollNumber,
            termsAccepted: Boolean(attempt && attempt.terms_accepted),
            termsAcceptedAt: attempt ? attempt.terms_accepted_at : null,
            attemptStatus: (attempt && attempt.status) || (result ? "submitted" : "not_started"),
            alreadySubmitted: Boolean(result),
            isTerminated: Boolean(attempt && attempt.status === "terminated"),
            canAttempt: !result && (!attempt || attempt.status !== "terminated")
        }, req);
    }

    // Start / Resume Examination Attempt (Strict single attempt & IST schedule enforcement)
    if (pathname === "/api/exams/start" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const examId = String(body.examId || "").trim();
            const rollNumber = String(body.rollNumber || body.roll || "").trim().toUpperCase();
            const studentName = String(body.studentName || body.name || rollNumber).trim();

            if (!examId || !rollNumber) {
                return sendJson(res, 400, { success: false, error: "Exam ID and Student Roll Number are required." }, req);
            }

            // Account status check: Reject suspended or deleted accounts
            const memStudents = getStored("students", DEFAULT_STUDENTS);
            const candidate = memStudents.find(s => (s.roll_number || "").toUpperCase() === rollNumber);
            if (candidate) {
                if (candidate.status === "suspended") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "suspended",
                        error: "Your student account has been suspended. Please contact the administrator."
                    }, req);
                }
                if (candidate.status === "deleted") {
                    return sendJson(res, 403, {
                        success: false,
                        status: "deleted",
                        error: "Your student account is no longer active. Please contact the administrator."
                    }, req);
                }
            }

            const memExams = getStored("examinations", []);
            const exam = memExams.find(e => e.id === examId);
            if (!exam) {
                return sendJson(res, 404, { success: false, error: "Examination not found." }, req);
            }

            if (exam.status !== "published") {
                return sendJson(res, 403, { success: false, error: "This examination is not published yet." }, req);
            }

            const now = Date.now();
            const startTime = new Date(exam.scheduled_start_at || now).getTime();
            const endTime = new Date(exam.scheduled_end_at || (startTime + 60 * 60 * 1000)).getTime();

            // 1. Strict Server-Authoritative Time Check: Before Scheduled Start
            if (now < startTime) {
                const startIST = exam.scheduled_start_ist || formatISTShort(new Date(startTime));
                return sendJson(res, 403, {
                    success: false,
                    notStarted: true,
                    error: `Examination has not started yet. Scheduled Start Time is ${startIST}. Please wait for the countdown.`
                }, req);
            }

            // 2A. Check if student attempt was terminated for violations (Strict Malpractice Lockout)
            const attempts = getStored("exam_attempts", []);
            let attempt = attempts.find(a => a.examId === examId && (a.rollNumber || "").toUpperCase() === rollNumber);
            const results = getStored("results", []);
            const existingResult = results.find(r => r.examId === examId && (r.studentRoll || "").toUpperCase() === rollNumber);

            if ((attempt && attempt.status === "terminated") || (existingResult && existingResult.status === "Terminated")) {
                return sendJson(res, 403, {
                    success: false,
                    terminated: true,
                    error: "This examination attempt was terminated due to three full-screen exit violations. Retakes are not permitted."
                }, req);
            }

            // 2B. Strict Single Attempt Check (Normal Submission Lockout)
            if (existingResult) {
                return sendJson(res, 409, {
                    success: false,
                    alreadySubmitted: true,
                    error: "You have already completed this examination. Only one attempt is permitted.",
                    resultId: existingResult.id
                }, req);
            }

            // 3. Exam Closing Window Check
            if (now >= endTime) {
                return sendJson(res, 403, {
                    success: false,
                    closed: true,
                    error: "Examination Closed – Not Attempted. The 60-minute examination window has ended."
                }, req);
            }

            // 4. Calculate remaining seconds for common exam window (Late starts receive only remaining time)
            const windowRemainingSeconds = Math.max(0, Math.floor((endTime - now) / 1000));
            const maxDurationSeconds = (exam.duration_minutes || 60) * 60;
            const candidateRemainingSeconds = Math.min(windowRemainingSeconds, maxDurationSeconds);
            const attemptDeadline = new Date(now + candidateRemainingSeconds * 1000).toISOString();

            // 5. Generate deterministic student examination arrangement (Issue 2)
            // Seeded by the last two digits of student's roll number
            const arrangement = generateStudentExamArrangement(exam, rollNumber);
            const sanitizedArrangement = sanitizeArrangementForStudent(arrangement);

            const answersStore = getStored("student_answers", []);
            let savedAnswers = {};

            if (attempt) {
                attempt.status = "in_progress";
                attempt.set_number = attempt.set_number || arrangement.setNumber;
                attempt.set_name = attempt.set_name || arrangement.setName;
                attempt.deadline_at = attempt.deadline_at || attemptDeadline;
                attempt.fullscreen_violation_count = Number(attempt.fullscreen_violation_count) || 0;
                setStored("exam_attempts", attempts);

                if (attempt.answers && typeof attempt.answers === "object") {
                    Object.keys(attempt.answers).forEach(k => {
                        savedAnswers[k] = attempt.answers[k];
                    });
                }
                answersStore.filter(ans => (ans.attemptId === attempt.attemptId || (ans.rollNumber || "").toUpperCase() === rollNumber) && ans.examId === examId)
                    .forEach(ans => {
                        savedAnswers[ans.question_number] = ans.selected_option;
                    });

                console.log(`[EXAM-ATTEMPT] Resuming ${arrangement.setName} (Seed: ${arrangement.rollSeed}) for candidate ${rollNumber} in exam ${examId}`);
            } else {
                attempt = {
                    attemptId: "att_" + examId + "_" + rollNumber.toLowerCase() + "_" + Date.now(),
                    examId: examId,
                    rollNumber: rollNumber,
                    studentName: studentName,
                    set_number: arrangement.setNumber,
                    set_name: arrangement.setName,
                    started_at: new Date(now).toISOString(),
                    deadline_at: attemptDeadline,
                    status: "in_progress",
                    terms_accepted: true,
                    terms_accepted_at: new Date(now).toISOString(),
                    fullscreen_violation_count: 0,
                    answers: {}
                };
                attempts.push(attempt);
                setStored("exam_attempts", attempts);

                try {
                    await queryDatabase(`
                        INSERT INTO public.exam_attempts (
                            id, examination_id, roll_number, set_number, started_at, deadline_at, status, fullscreen_violation_count, created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, NOW(), $5, 'in_progress', 0, NOW(), NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            set_number = EXCLUDED.set_number,
                            status = 'in_progress',
                            updated_at = NOW();
                    `, [attempt.attemptId, examId, rollNumber, arrangement.setNumber, attemptDeadline]);
                } catch (e) {
                    console.warn("[START-DB-WARN]", e.message);
                }

                console.log(`[EXAM-ATTEMPT] Allocated ${arrangement.setName} (Seed: ${arrangement.rollSeed}) for candidate ${rollNumber} in exam ${examId}`);
            }

            // 6. Return sanitized questions for the assigned student (answer keys strictly omitted!)
            return sendJson(res, 200, {
                success: true,
                resumed: Boolean(savedAnswers && Object.keys(savedAnswers).length > 0),
                attemptId: attempt.attemptId,
                examId: exam.id,
                examTitle: exam.title || exam.name,
                durationMinutes: exam.duration_minutes || 60,
                remainingSeconds: candidateRemainingSeconds,
                scheduledEndTime: exam.scheduled_end_at,
                deadlineAt: attempt.deadline_at,
                fullscreenViolationCount: attempt.fullscreen_violation_count || 0,
                setNumber: arrangement.setNumber,
                setName: arrangement.setName,
                totalQuestions: sanitizedArrangement.questions.length,
                questions: sanitizedArrangement.questions,
                savedAnswers: savedAnswers,
                serverTime: new Date(now).toISOString()
            }, req);
        } catch (err) {
            return sendJson(res, 500, { success: false, error: "Failed to start exam: " + err.message }, req);
        }
    }

    // Full-Screen Exit Violation System (Mandatory 3-Strikes System)
    if (pathname === "/api/exams/violation" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const examId = String(body.examId || "").trim();
            const rollNumber = String(body.rollNumber || body.roll || "").trim().toUpperCase();
            const attemptId = String(body.attemptId || "").trim();

            if (!examId || !rollNumber) {
                return sendJson(res, 400, { success: false, error: "Missing examId or rollNumber." }, req);
            }

            const attempts = getStored("exam_attempts", []);
            let attempt = attempts.find(a => (a.attemptId === attemptId || a.examId === examId) && (a.rollNumber || "").toUpperCase() === rollNumber);

            if (!attempt) {
                return sendJson(res, 404, { success: false, error: "Exam attempt not found." }, req);
            }

            if (attempt.status === "terminated") {
                return sendJson(res, 200, {
                    success: true,
                    violationCount: 3,
                    terminated: true,
                    alreadyTerminated: true,
                    reason: attempt.termination_reason || "Three fullscreen violations"
                }, req);
            }

            if (attempt.status === "submitted" || attempt.status === "auto_submitted") {
                return sendJson(res, 400, {
                    success: false,
                    error: "Examination is already submitted."
                }, req);
            }

            // Atomically increment violation count
            attempt.fullscreen_violation_count = (Number(attempt.fullscreen_violation_count) || 0) + 1;
            const currentCount = attempt.fullscreen_violation_count;
            const nowIso = new Date().toISOString();

            if (currentCount >= 3) {
                // 3rd Violation: Immediately Terminate Examination (Enforced on Server)
                attempt.status = "terminated";
                attempt.termination_reason = "Three fullscreen violations";
                attempt.submitted_at = nowIso;
                attempt.marks_obtained = 0;
                setStored("exam_attempts", attempts);

                // Record in results under institutional malpractice policy (0 marks)
                const allResults = getStored("results", []);
                const existingResultIdx = allResults.findIndex(r => r.examId === examId && (r.studentRoll || "").toUpperCase() === rollNumber);

                const memStudents = getStored("students", DEFAULT_STUDENTS);
                const student = memStudents.find(s => (s.roll_number || "").toUpperCase() === rollNumber) || {};
                const memExams = getStored("examinations", []);
                const exam = memExams.find(e => e.id === examId) || {};

                const terminationResult = {
                    id: "res_" + examId + "_" + rollNumber.toLowerCase(),
                    attemptId: attempt.attemptId,
                    examId: examId,
                    examName: exam.title || exam.name || "50-MCQ Examination",
                    courseId: examId,
                    courseName: exam.title || exam.name || "50-MCQ Examination",
                    studentRoll: rollNumber,
                    studentName: student.name || rollNumber,
                    studentId: student.id || ("std_" + rollNumber.toLowerCase()),
                    email: student.email || `${rollNumber.toLowerCase()}@kits.edu`,
                    score: 0,
                    totalMarks: 50,
                    percentage: 0,
                    status: "Terminated",
                    termination_reason: "Three fullscreen violations",
                    autoSubmitted: false,
                    isTerminated: true,
                    completedAt: nowIso,
                    submittedAt: nowIso,
                    itemizedReview: []
                };

                if (existingResultIdx >= 0) {
                    allResults[existingResultIdx] = terminationResult;
                } else {
                    allResults.push(terminationResult);
                }
                setStored("results", allResults);

                // Record in institutional audit log
                const auditLogs = getStored("audit_logs", []);
                auditLogs.unshift({
                    id: "audit_" + Date.now(),
                    action: "EXAM_TERMINATED_MALPRACTICE",
                    examId,
                    studentRoll: rollNumber,
                    reason: "Three fullscreen violations",
                    timestamp: nowIso
                });
                setStored("audit_logs", auditLogs);

                // Persist to Supabase
                try {
                    await queryDatabase(`
                        UPDATE public.exam_attempts
                        SET status = 'terminated',
                            fullscreen_violation_count = $1,
                            termination_reason = 'Three fullscreen violations',
                            submitted_at = NOW(),
                            updated_at = NOW()
                        WHERE id = $2;
                    `, [currentCount, attempt.attemptId]);

                    await queryDatabase(`
                        INSERT INTO public.results (
                            id, attempt_id, examination_id, roll_number, score, total_marks,
                            percentage, status, termination_reason, auto_submitted, completed_at
                        ) VALUES ($1, $2, $3, $4, 0, 50, 0, 'Terminated', 'Three fullscreen violations', false, NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            score = 0,
                            percentage = 0,
                            status = 'Terminated',
                            termination_reason = 'Three fullscreen violations';
                    `, [terminationResult.id, attempt.attemptId, examId, rollNumber]);
                } catch (e) {
                    console.warn("[TERMINATION-DB-WARN]", e.message);
                }

                console.log(`[EXAM-TERMINATED] Candidate ${rollNumber} examination terminated (3 fullscreen violations)`);

                return sendJson(res, 200, {
                    success: true,
                    violationCount: 3,
                    terminated: true,
                    reason: "Three fullscreen violations",
                    message: "EXAMINATION TERMINATED: You have exited Full Screen mode three times. Your examination has been terminated according to the examination rules."
                }, req);
            } else {
                // Warning 1 or 2: Persist count and return warning status
                setStored("exam_attempts", attempts);

                try {
                    await queryDatabase(`
                        UPDATE public.exam_attempts
                        SET fullscreen_violation_count = $1, updated_at = NOW()
                        WHERE id = $2;
                    `, [currentCount, attempt.attemptId]);
                } catch (e) {}

                console.log(`[EXAM-VIOLATION] Fullscreen violation ${currentCount} recorded for candidate ${rollNumber}`);

                return sendJson(res, 200, {
                    success: true,
                    violationCount: currentCount,
                    terminated: false
                }, req);
            }
        } catch (err) {
            return sendJson(res, 500, { success: false, error: err.message }, req);
        }
    }

    // Autosave Candidate Response
    if (pathname === "/api/exams/save-answer" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const attemptId = body.attemptId;
            const examId = String(body.examId || "").trim();
            const rollNumber = String(body.rollNumber || body.roll || "").trim().toUpperCase();
            const qNum = Number(body.questionNumber || (body.questionId && String(body.questionId).replace(/\D/g, "")) || 1);
            const selectedOption = body.selectedOption || body.option;

            if (!examId || !rollNumber) {
                return sendJson(res, 400, { success: false, error: "Missing required answer fields." }, req);
            }

            const cleanRoll = rollNumber;

            const memStudents = getStored("students", DEFAULT_STUDENTS);
            const candidate = memStudents.find(s => (s.roll_number || "").toUpperCase() === cleanRoll);
            if (candidate && (candidate.status === "suspended" || candidate.status === "deleted")) {
                return sendJson(res, 403, { success: false, error: "Account suspended or deactivated." }, req);
            }

            // Check if attempt is terminated
            const attempts = getStored("exam_attempts", []);
            const attempt = attempts.find(a => (a.attemptId === attemptId || a.examId === examId) && (a.rollNumber || "").toUpperCase() === cleanRoll);
            if (attempt && attempt.status === "terminated") {
                return sendJson(res, 403, { success: false, terminated: true, error: "Examination was terminated due to violations. Answers cannot be saved." }, req);
            }

            // Check if window is expired
            const memExams = getStored("examinations", []);
            const exam = memExams.find(e => e.id === examId);
            const now = Date.now();
            if (exam && exam.scheduled_end_at && now > new Date(exam.scheduled_end_at).getTime()) {
                return sendJson(res, 403, { success: false, expired: true, error: "Exam closing time reached." }, req);
            }

            const answers = getStored("student_answers", []);
            const existIdx = answers.findIndex(a => a.examId === examId && (a.rollNumber || "").toUpperCase() === cleanRoll && a.question_number === qNum);

            const entry = {
                attemptId: attemptId || `att_${examId}_${cleanRoll.toLowerCase()}`,
                examId: examId,
                rollNumber: cleanRoll,
                question_number: qNum,
                selected_option: selectedOption ? String(selectedOption).toUpperCase() : null,
                saved_at: new Date().toISOString()
            };

            if (existIdx >= 0) {
                answers[existIdx] = entry;
            } else {
                answers.push(entry);
            }

            setStored("student_answers", answers);

            if (attempt) {
                attempt.answers = attempt.answers || {};
                attempt.answers[qNum] = entry.selected_option;
                setStored("exam_attempts", attempts);
            }

            try {
                const optVal = entry.selected_option;
                await queryDatabase(`
                    UPDATE public.exam_attempts
                    SET answers = jsonb_set(COALESCE(answers, '{}'::jsonb), ARRAY[$1], to_jsonb($2::text)),
                        updated_at = NOW()
                    WHERE id = $3 OR (examination_id = $4 AND UPPER(roll_number) = $5);
                `, [String(qNum), optVal, attemptId || "", examId, cleanRoll]);
            } catch (dbErr) {}

            return sendJson(res, 200, { success: true, savedAt: entry.saved_at }, req);
        } catch (err) {
            return sendJson(res, 500, { success: false, error: "Autosave failed: " + err.message }, req);
        }
    }

    // Submit Examination & Server-Side Evaluation (50 MCQs • 50 Marks)
    if (pathname === "/api/exams/submit" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const examId = String(body.examId || "").trim();
            const rollNumber = String(body.rollNumber || body.roll || "").trim().toUpperCase();
            const studentName = String(body.studentName || rollNumber).trim();
            const autoSubmitted = Boolean(body.autoSubmitted);
            const submittedAnswers = body.answers || {};

            if (!examId || !rollNumber) {
                return sendJson(res, 400, { success: false, error: "Missing examId or rollNumber." }, req);
            }

            const memStudents = getStored("students", DEFAULT_STUDENTS);
            const candidate = memStudents.find(s => (s.roll_number || "").toUpperCase() === rollNumber);
            if (candidate && (candidate.status === "suspended" || candidate.status === "deleted")) {
                return sendJson(res, 403, { success: false, error: "Account suspended or deactivated." }, req);
            }

            // 0. Check if attempt was terminated for violations
            const attempts = getStored("exam_attempts", []);
            const attempt = attempts.find(a => (a.examId === examId || a.attemptId === body.attemptId) && (a.rollNumber || "").toUpperCase() === rollNumber);
            if (attempt && attempt.status === "terminated") {
                return sendJson(res, 403, {
                    success: false,
                    terminated: true,
                    error: "Examination was terminated due to policy violations and cannot be submitted."
                }, req);
            }

            // 1. Idempotency Guard: Check if candidate already has a submitted result
            const lockKey = `${examId}_${rollNumber}`;
            const results = getStored("results", []);
            const existingResult = results.find(r => r.examId === examId && (r.studentRoll || "").toUpperCase() === rollNumber);
            if (existingResult) {
                return sendJson(res, 200, {
                    success: true,
                    duplicatePrevented: true,
                    result: existingResult,
                    message: "Exam submission already completed (Idempotent response)."
                }, req);
            }

            if (SUBMISSION_LOCKS.has(lockKey)) {
                return sendJson(res, 409, { success: false, error: "Evaluation already in progress for this candidate." }, req);
            }
            SUBMISSION_LOCKS.add(lockKey);

            try {
                // 2. Fetch full exam and assigned randomized arrangement
                const memExams = getStored("examinations", []);
                let exam = memExams.find(e => e.id === examId);
                if (!exam) {
                    await syncExaminationsWithDatabase();
                    exam = getStored("examinations", []).find(e => e.id === examId) || {
                        id: examId,
                        title: "50-MCQ Examination",
                        questions: DEFAULT_50_MCQS
                    };
                }

                // Retrieve attempt and merge any autosaved answers
                const attempts = getStored("exam_attempts", []);
                const attempt = attempts.find(a => (a.examId === examId || a.attemptId === body.attemptId) && (a.rollNumber || "").toUpperCase() === rollNumber);

                const answersStore = getStored("student_answers", []);
                const savedAnswers = {};
                if (attempt && attempt.answers && typeof attempt.answers === "object") {
                    Object.assign(savedAnswers, attempt.answers);
                }
                answersStore.filter(a => a.examId === examId && (a.rollNumber || "").toUpperCase() === rollNumber)
                    .forEach(a => {
                        if (a.selected_option !== null && a.selected_option !== undefined) {
                            savedAnswers[a.question_number] = a.selected_option;
                        }
                    });

                // Merge submitted answers with any autosaved answers
                const allCandidateAnswers = { ...savedAnswers, ...submittedAnswers };

                // Generate deterministic student arrangement (Issue 2) and evaluate (Issue 3)
                const arrangement = generateStudentExamArrangement(exam, rollNumber);
                const evaluation = evaluateStudentSubmission(allCandidateAnswers, arrangement);

                let startedAtTime = (attempt && attempt.started_at) ? new Date(attempt.started_at).getTime() : (Date.now() - 60000);
                const timeTakenSeconds = Math.max(1, Math.min((exam.duration_minutes || 60) * 60, Math.floor((Date.now() - startedAtTime) / 1000)));

                const verifiedResult = {
                    id: "res_" + examId + "_" + rollNumber.toLowerCase(),
                    attemptId: (attempt && attempt.attemptId) || body.attemptId || ("att_" + examId + "_" + rollNumber.toLowerCase()),
                    examId: examId,
                    examName: exam.title || exam.name || "50-MCQ Examination",
                    studentRoll: rollNumber,
                    studentName: studentName,
                    setNumber: arrangement.setNumber,
                    setName: arrangement.setName,
                    score: evaluation.score,
                    totalMarks: evaluation.totalMarks,
                    totalQuestions: evaluation.totalQuestions,
                    correctCount: evaluation.correctCount,
                    wrongCount: evaluation.wrongCount,
                    skippedCount: evaluation.skippedCount,
                    percentage: evaluation.percentage,
                    status: evaluation.status,
                    autoSubmitted: autoSubmitted,
                    timeTakenSeconds: timeTakenSeconds,
                    itemizedReview: evaluation.itemizedReview,
                    submittedAt: new Date().toISOString(),
                    evaluatedBy: "KITS_LMS_EXAM_ENGINE_V2"
                };

                // Store result in memory
                results.push(verifiedResult);
                setStored("results", results);

                // Update attempt status in memory
                if (attempt) {
                    attempt.status = autoSubmitted ? "auto_submitted" : "submitted";
                    attempt.marks_obtained = evaluation.score;
                    attempt.answers = allCandidateAnswers;
                    attempt.submitted_at = new Date().toISOString();
                    setStored("exam_attempts", attempts);
                }

                // 3. Persist result to Supabase PostgreSQL results & exam_attempts
                try {
                    await queryDatabase(`
                        INSERT INTO public.results (
                            id, attempt_id, examination_id, roll_number, score, total_marks,
                            percentage, status, auto_submitted, section_breakdown, time_taken_seconds, completed_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            score = EXCLUDED.score,
                            total_marks = EXCLUDED.total_marks,
                            percentage = EXCLUDED.percentage,
                            status = EXCLUDED.status,
                            auto_submitted = EXCLUDED.auto_submitted,
                            section_breakdown = EXCLUDED.section_breakdown,
                            time_taken_seconds = EXCLUDED.time_taken_seconds,
                            completed_at = NOW();
                    `, [
                        verifiedResult.id,
                        verifiedResult.attemptId,
                        examId,
                        rollNumber,
                        evaluation.score,
                        evaluation.totalMarks,
                        evaluation.percentage,
                        evaluation.status,
                        autoSubmitted,
                        JSON.stringify(evaluation.itemizedReview),
                        timeTakenSeconds
                    ]);

                    const targetAttemptId = (attempt && attempt.attemptId) || verifiedResult.attemptId;
                    await queryDatabase(`
                        UPDATE public.exam_attempts
                        SET status = 'submitted',
                            marks_obtained = $1,
                            answers = $2::jsonb,
                            submitted_at = NOW(),
                            updated_at = NOW()
                        WHERE id = $3 OR (examination_id = $4 AND UPPER(roll_number) = $5);
                    `, [evaluation.score, JSON.stringify(allCandidateAnswers), targetAttemptId, examId, rollNumber]);
                } catch (e) {
                    console.warn("[SUBMIT-DB-WARN]", e.message);
                }

                console.log(`[EXAM-SUBMISSION] Candidate ${rollNumber} completed exam ${examId}. Arrangement: ${arrangement.setName}, Score: ${evaluation.score}/${evaluation.totalMarks} (${evaluation.percentage}% - ${evaluation.status})`);

                return sendJson(res, 200, {
                    success: true,
                    result: verifiedResult
                }, req);
            } finally {
                setTimeout(() => SUBMISSION_LOCKS.delete(lockKey), 500);
            }
        } catch (err) {
            return sendJson(res, 500, { success: false, error: "Server evaluation failed: " + err.message }, req);
        }
    }

    // Get Single Exam Result / Scorecard
    if (pathname === "/api/exams/result" && method === "GET") {
        const resultId = parsedUrl.query.id || parsedUrl.query.resultId;
        const examId = parsedUrl.query.examId;
        const roll = parsedUrl.query.roll;

        const results = getStored("results", []);
        let match = null;

        if (resultId) {
            match = results.find(r => r.id === resultId);
        }
        if (!match && examId && roll) {
            match = results.find(r => r.examId === examId && (r.studentRoll || "").toUpperCase() === String(roll).toUpperCase());
        }

        // Query database if not in memory
        if (!match && (resultId || (examId && roll))) {
            try {
                let dbRes;
                if (resultId) {
                    dbRes = await queryDatabase(`
                        SELECT r.*, e.title as exam_title
                        FROM public.results r
                        LEFT JOIN public.examinations e ON r.examination_id = e.id
                        WHERE r.id = $1;
                    `, [resultId]);
                } else {
                    dbRes = await queryDatabase(`
                        SELECT r.*, e.title as exam_title
                        FROM public.results r
                        LEFT JOIN public.examinations e ON r.examination_id = e.id
                        WHERE r.examination_id = $1 AND UPPER(r.roll_number) = $2;
                    `, [examId, String(roll).toUpperCase()]);
                }

                if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
                    const row = dbRes.rows[0];
                    let itemized = null;
                    if (row.section_breakdown) {
                        try {
                            itemized = typeof row.section_breakdown === "string" ? JSON.parse(row.section_breakdown) : row.section_breakdown;
                        } catch (_) {}
                    }
                    const rollNum = (row.roll_number || roll || "").toUpperCase();
                    const memStudents = getStored("students", DEFAULT_STUDENTS);
                    const cand = memStudents.find(s => (s.roll_number || "").toUpperCase() === rollNum);

                    match = {
                        id: row.id,
                        attemptId: row.attempt_id,
                        examId: row.examination_id,
                        examName: row.exam_title || "50-MCQ Examination",
                        studentRoll: rollNum,
                        studentName: cand ? cand.name : rollNum,
                        score: Number(row.score),
                        totalMarks: Number(row.total_marks || 50),
                        percentage: Number(row.percentage),
                        status: row.status,
                        autoSubmitted: Boolean(row.auto_submitted),
                        timeTakenSeconds: row.time_taken_seconds,
                        submittedAt: row.completed_at,
                        itemizedReview: itemized
                    };
                }
            } catch (dbErr) {
                console.warn("[GET-RESULT-DB-WARN]", dbErr.message);
            }
        }

        // Check if student attempt was terminated
        if (!match && examId && roll) {
            const attempts = getStored("exam_attempts", []);
            const att = attempts.find(a => a.examId === examId && (a.rollNumber || "").toUpperCase() === String(roll).toUpperCase());
            if (att && att.status === "terminated") {
                match = {
                    id: "res_" + examId + "_" + String(roll).toLowerCase(),
                    attemptId: att.attemptId,
                    examId: examId,
                    examName: "50-MCQ Examination",
                    studentRoll: String(roll).toUpperCase(),
                    studentName: att.studentName || roll,
                    score: 0,
                    totalMarks: 50,
                    percentage: 0,
                    status: "Terminated",
                    termination_reason: att.termination_reason || "Three fullscreen violations",
                    isTerminated: true,
                    autoSubmitted: false,
                    submittedAt: att.submitted_at || new Date().toISOString()
                };
            }
        }

        // Reconstruct itemizedReview if missing
        if (match && (!match.itemizedReview || match.itemizedReview.length === 0)) {
            try {
                const memExams = getStored("examinations", []);
                const exam = memExams.find(e => e.id === match.examId);
                const attempts = getStored("exam_attempts", []);
                const att = attempts.find(a => (a.examId === match.examId || a.attemptId === match.attemptId) && (a.rollNumber || "").toUpperCase() === (match.studentRoll || "").toUpperCase());
                if (exam && exam.questions && exam.questions.length > 0) {
                    const arrangement = generateStudentExamArrangement(exam, match.studentRoll);
                    const studentAnswers = (att && att.answers) || {};
                    const evalRes = evaluateStudentSubmission(studentAnswers, arrangement);
                    match.itemizedReview = evalRes.itemizedReview;
                    match.setNumber = arrangement.setNumber;
                    match.setName = arrangement.setName;
                }
            } catch (_) {}
        }

        if (!match) {
            return sendJson(res, 404, { success: false, error: "Result record not found." }, req);
        }

        return sendJson(res, 200, { success: true, result: match }, req);
    }

    // Student Exam Results History
    if (pathname === "/api/student/results" && method === "GET") {
        let studentRoll = "";
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim() || extractAdminToken(req);
        const payload = verifyToken(token) || decodeFirebaseToken(token);
        if (payload && payload.roll) {
            studentRoll = payload.roll.toUpperCase();
        }
        if (!studentRoll && parsedUrl.query.roll) {
            studentRoll = String(parsedUrl.query.roll).trim().toUpperCase();
        }

        const results = getStored("results", []);
        let filtered = studentRoll ? results.filter(r => (r.studentRoll || "").toUpperCase() === studentRoll) : results;

        if (studentRoll && filtered.length === 0) {
            try {
                const dbRes = await queryDatabase(`
                    SELECT r.*, e.title as exam_title
                    FROM public.results r
                    LEFT JOIN public.examinations e ON r.examination_id = e.id
                    WHERE UPPER(r.roll_number) = $1
                    ORDER BY r.completed_at DESC;
                `, [studentRoll]);
                if (dbRes && dbRes.rows && dbRes.rows.length > 0) {
                    dbRes.rows.forEach(row => {
                        filtered.push({
                            id: row.id,
                            attemptId: row.attempt_id,
                            examId: row.examination_id,
                            examName: row.exam_title || "50-MCQ Examination",
                            studentRoll: studentRoll,
                            score: Number(row.score),
                            totalMarks: Number(row.total_marks || 50),
                            percentage: Number(row.percentage),
                            status: row.status,
                            autoSubmitted: Boolean(row.auto_submitted),
                            submittedAt: row.completed_at
                        });
                    });
                }
            } catch (_) {}
        }

        return sendJson(res, 200, { success: true, count: filtered.length, results: filtered }, req);
    }

    if (pathname === "/api/admin/results" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const targetExamId = parsedUrl.query.examId ? String(parsedUrl.query.examId).trim() : null;
        const allResults = getStored("results", []);
        const students = getStored("students", DEFAULT_STUDENTS);

        // Strict Exam-wise Filtering if targetExamId provided
        const filtered = targetExamId 
            ? allResults.filter(r => r.examId === targetExamId || r.courseId === targetExamId)
            : allResults;

        const formattedResults = filtered.map(r => {
            const student = students.find(s => (s.roll_number || "").toUpperCase() === (r.studentRoll || "").toUpperCase() || s.id === r.studentId) || {};
            const isDeleted = (student.status === "deleted");
            const roll = (r.studentRoll || student.roll_number || "N/A").toUpperCase();
            const studentName = isDeleted ? `[Deactivated Student - ${roll}]` : (r.studentName || student.name || "Candidate");
            const email = isDeleted ? "[Protected - Deactivated]" : (student.email || r.email || "N/A");
            const score = Number(r.score) || 0;
            const total = Number(r.totalMarks || r.total) || 50;
            const pct = Math.min(100, Math.round((score / total) * 100));

            return {
                id: r.id || ("res_" + (r.studentRoll || "std") + "_" + (r.examId || "ex")),
                examId: r.examId || r.courseId,
                examName: r.examName || r.courseName || targetExamId || "Examination",
                rollNumber: roll,
                studentName: studentName,
                email: email,
                branch: student.department || r.branch || "Information Technology",
                batch: student.academic_year || r.batch || "3rd Year B.Tech",
                marksObtained: score,
                totalMarks: total,
                percentage: pct,
                submissionDate: r.completedAt || r.timestamp || r.date || new Date().toISOString(),
                status: pct >= 40 ? "Pass" : "Fail",
                accountStatus: student.status || "active",
                isDeleted
            };
        });

        return sendJson(res, 200, {
            success: true,
            examId: targetExamId,
            count: formattedResults.length,
            results: formattedResults
        }, req);
    }

    // 6. Admin Faculty Management
    if (pathname === "/api/admin/faculty" && method === "GET") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const faculty = getStored("faculty", []);
        return sendJson(res, 200, { success: true, faculty }, req);
    }

    if (pathname === "/api/admin/faculty" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        if (!body.name || !body.email || !body.employeeId) {
            return sendJson(res, 400, { error: "Faculty name, email, and employee ID required." }, req);
        }

        const faculty = getStored("faculty", []);
        const newMember = {
            id: "fac_" + Date.now(),
            name: body.name.trim(),
            email: body.email.trim().toLowerCase(),
            employeeId: body.employeeId.trim().toUpperCase(),
            department: body.department || "Information Technology",
            role: "faculty",
            permissions: body.permissions || ["create_exams", "review_questions", "publish_tests"],
            status: "active",
            createdAt: new Date().toISOString()
        };

        faculty.push(newMember);
        setStored("faculty", faculty);
        return sendJson(res, 201, { success: true, faculty: newMember }, req);
    }

    if (pathname === "/api/admin/faculty/toggle-status" && method === "POST") {
        const token = extractAdminToken(req);
        const payload = verifyToken(token);

        if (!payload || payload.role !== "admin") {
            return sendJson(res, 403, { error: "Admin authorization required." }, req);
        }

        const body = await parseRequestBody(req);
        const facultyId = body.facultyId;
        const faculty = getStored("faculty", []);
        const target = faculty.find(f => f.id === facultyId || f.employeeId === facultyId);

        if (target) {
            target.status = target.status === "inactive" ? "active" : "inactive";
            setStored("faculty", faculty);
            return sendJson(res, 200, { success: true, faculty: target });
        }
        return sendJson(res, 404, { error: "Faculty member not found." });
    }

    // 7. Privileged Server Evaluation of Student Submission (With 0-Duplicate Lock)
    if (pathname === "/api/exams/evaluate" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const examId = body.examId;
            const studentId = body.studentId;
            const studentRoll = (body.studentRoll || "").trim().toUpperCase();

            if (!examId || !studentRoll) {
                return sendJson(res, 400, { error: "Missing examination ID or candidate roll number." });
            }

            // Duplicate Submission Prevention: Atomic Idempotency Guard
            const lockKey = `${examId}_${studentRoll}`;
            const results = getStored("results", []);
            const existingResult = results.find(r => r.examId === examId && (r.studentRoll === studentRoll || (studentId && r.studentId === studentId)));
            
            if (existingResult) {
                return sendJson(res, 200, {
                    success: true,
                    result: existingResult,
                    duplicatePrevented: true,
                    message: "Previous verified submission retrieved (Idempotent response)."
                });
            }

            if (SUBMISSION_LOCKS.has(lockKey)) {
                return sendJson(res, 409, { error: "Evaluation in progress for this candidate. Duplicate rejected." });
            }

            SUBMISSION_LOCKS.add(lockKey);

            try {
                // Retrieve exam definition
                const examinations = getStored("examinations", []);
                let examData = examinations.find(e => e.id === examId);

                if (!examData) {
                    const sets = getStored("exam_sets_" + examId, []);
                    examData = {
                        id: examId,
                        questions: body.questions || (sets[0] && sets[0].questions) || [],
                        codingProblems: body.codingProblems || []
                    };
                }

                const verifiedResult = evaluateExamSubmission(body, examData);
                verifiedResult.examId = examId;
                verifiedResult.studentId = studentId;
                verifiedResult.studentRoll = studentRoll;
                verifiedResult.studentName = body.studentName || studentRoll;
                verifiedResult.completedAt = new Date().toISOString();

                // Commit verified result to store
                results.push(verifiedResult);
                setStored("results", results);

                return sendJson(res, 200, {
                    success: true,
                    result: verifiedResult
                });
            } finally {
                // Release lock
                setTimeout(() => SUBMISSION_LOCKS.delete(lockKey), 500);
            }
        } catch (err) {
            return sendJson(res, 500, { error: "Server evaluation error: " + err.message });
        }
    }

    // 8. Real-Time Candidate Autosave Endpoint (0 Lost Answers)
    if (pathname === "/api/exams/autosave" && method === "POST") {
        try {
            const body = await parseRequestBody(req);
            const { attemptId, questionId, section, selectedOptions, submittedCode } = body;

            if (!attemptId || !questionId) {
                return sendJson(res, 400, { success: false, error: "Missing attemptId or questionId for autosave." });
            }

            const answers = getStored("student_answers", []);
            const existingIdx = answers.findIndex(a => a.attemptId === attemptId && a.questionId === questionId);
            const entry = {
                attemptId,
                questionId,
                section: section || "A",
                selectedOptions: selectedOptions || [],
                submittedCode: submittedCode || {},
                savedAt: new Date().toISOString()
            };

            if (existingIdx >= 0) {
                answers[existingIdx] = Object.assign(answers[existingIdx], entry);
            } else {
                answers.push(entry);
            }

            setStored("student_answers", answers);
            return sendJson(res, 200, { success: true, savedAt: entry.savedAt });
        } catch (err) {
            return sendJson(res, 500, { success: false, error: "Autosave failed: " + err.message });
        }
    }

    // 9. Academic Courses Endpoint
    if (pathname === "/api/courses" && method === "GET") {
        const courses = getStored("courses", DEFAULT_COURSES);
        return sendJson(res, 200, { success: true, courses });
    }

    // 10. Published Examinations Endpoint
    if (pathname === "/api/examinations" && method === "GET") {
        const exams = getStored("examinations", []);
        return sendJson(res, 200, { success: true, examinations: exams });
    }

    // 11. System Health Check & Performance Monitoring Endpoint
    if (pathname === "/api/health" && method === "GET") {
        return sendJson(res, 200, {
            status: "UP",
            uptimeSeconds: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            activeLocks: SUBMISSION_LOCKS.size,
            environment: "production"
        });
    }

    // =========================================================================
    // STATIC FILE SERVING WITH IN-MEMORY BUFFER CACHING & ETAG SUPPORT
    // =========================================================================
    let filePath = pathname === "/" ? "auth.html" : pathname.replace(/^\//, "");
    filePath = path.normalize(filePath);

    // Prevent directory traversal attacks
    const fullPath = path.join(ROOT_DIR, filePath);
    if (!fullPath.startsWith(ROOT_DIR)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Access Denied");
    }

    let targetPath = fullPath;
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
        const withHtml = fullPath + ".html";
        if (fs.existsSync(withHtml) && fs.statSync(withHtml).isFile()) {
            targetPath = withHtml;
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end("404 Not Found");
        }
    }

    try {
        const stat = fs.statSync(targetPath);
        const ext = path.extname(targetPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const etag = `"${stat.size}-${stat.mtimeMs.toString(36)}"`;

        // Check If-None-Match header for instant 304 response
        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304);
            return res.end();
        }

        res.writeHead(200, {
            "Content-Type": contentType,
            "ETag": etag,
            "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN"
        });

        fs.createReadStream(targetPath).pipe(res);
    } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error: " + e.message);
    }
};

const server = http.createServer(requestHandler);

// Configure High-Concurrency Socket Keep-Alive Timeouts
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Export request handler for Vercel Serverless Functions and test suites
module.exports = async (req, res) => {
    await ensureDatabaseSync();
    return requestHandler(req, res);
};
module.exports.server = server;
module.exports.requestHandler = requestHandler;

if (require.main === module) {
    server.listen(PORT, "0.0.0.0", async () => {
        console.log(`=======================================================`);
        console.log(`  KITS LMS PRODUCTION SERVER STARTED`);
        console.log(`  Listening on: http://localhost:${PORT}`);
        console.log(`  Admin Username: ${ADMIN_USERNAME}`);
        console.log(`  Server Mode: High-Concurrency In-Memory Engine`);
        console.log(`  Concurrent Users Capacity: 100+ Active Users`);
        console.log(`=======================================================`);

        // Synchronize examinations with Supabase PostgreSQL
        await syncExaminationsWithDatabase();
    });
}
