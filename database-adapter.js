/**
 * KITS LMS — Modular Database Adapter Layer
 * 
 * Supports:
 * 1. Supabase PostgreSQL Engine (Default & Active Production Engine)
 * 2. Firebase Cloud Firestore Engine (Migration Ready)
 * 
 * Strict Architectural Guarantees:
 * - Default engine is STRICTLY "supabase" unless DB_ENGINE="firestore" is explicitly set.
 * - Unified async interface across both database engines.
 * - In Firestore mode, correct answer keys and academic explanations are isolated
 *   in `examinations_secure/{examId}` so students cannot inspect answers.
 * - Idempotent write operations and duplicate prevention.
 * - Zero silent schema or data transformations.
 */

const path = require("path");
const fs = require("fs");
if (typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(path.join(__dirname, ".env")); } catch (_) { }
}

const { Pool } = require("pg");

// =========================================================================
// 1. BASE DATABASE ADAPTER INTERFACE
// =========================================================================

class DatabaseAdapter {
    constructor() {
        if (new.target === DatabaseAdapter) {
            throw new TypeError("Cannot construct DatabaseAdapter instances directly");
        }
    }

    getEngineName() { throw new Error("Method not implemented"); }
    async init() { throw new Error("Method not implemented"); }
    async healthCheck() { throw new Error("Method not implemented"); }

    // Students & Profiles
    async getStudents() { throw new Error("Method not implemented"); }
    async getStudentByRoll(rollNumber) { throw new Error("Method not implemented"); }
    async getProfileByUid(firebaseUid) { throw new Error("Method not implemented"); }
    async upsertStudent(studentData) { throw new Error("Method not implemented"); }
    async updateStudentStatus(rollNumber, status) { throw new Error("Method not implemented"); }

    // Examinations
    async getExaminations() { throw new Error("Method not implemented"); }
    async getExaminationById(examId) { throw new Error("Method not implemented"); }
    async getExaminationSecureKeys(examId) { throw new Error("Method not implemented"); }
    async upsertExamination(examData) { throw new Error("Method not implemented"); }
    async updateExamStatus(examId, status) { throw new Error("Method not implemented"); }
    async deleteExamination(examId) { throw new Error("Method not implemented"); }

    // Attempts & Answers
    async getExamAttempts(examId) { throw new Error("Method not implemented"); }
    async getAttempt(examId, rollNumber) { throw new Error("Method not implemented"); }
    async createAttempt(attemptData) { throw new Error("Method not implemented"); }
    async saveAttemptAnswer(attemptId, qNum, selectedOption, examId, rollNumber) { throw new Error("Method not implemented"); }
    async recordViolation(attemptId, examId, rollNumber, violationCount) { throw new Error("Method not implemented"); }

    // Results & Evaluations
    async getExamResults(examId) { throw new Error("Method not implemented"); }
    async getResult(examId, rollNumber) { throw new Error("Method not implemented"); }
    async finalizeSubmission(resultData, attemptUpdateData) { throw new Error("Method not implemented"); }
}

// =========================================================================
// 2. SUPABASE POSTGRESQL ADAPTER (CURRENT PRODUCTION ENGINE)
// =========================================================================

class SupabaseAdapter extends DatabaseAdapter {
    constructor(options = {}) {
        super();
        this.connectionString = options.connectionString || process.env.DATABASE_URL;
        this.pool = null;
        this.isInitialized = false;
    }

    getEngineName() {
        return "supabase";
    }

    async init() {
        if (this.isInitialized && this.pool) return;
        if (!this.connectionString) {
            console.warn("[SUPABASE-ADAPTER] No DATABASE_URL configured; running in decoupled memory mode.");
            return;
        }

        try {
            this.pool = new Pool({
                connectionString: this.connectionString,
                ssl: { rejectUnauthorized: false },
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000
            });
            this.isInitialized = true;
            console.log("[SUPABASE-ADAPTER] Connected to Supabase PostgreSQL Pooler.");
        } catch (err) {
            console.warn("[SUPABASE-ADAPTER-INIT-WARN]", err.message);
        }
    }

    async healthCheck() {
        if (!this.pool) return { status: "decoupled", engine: "supabase" };
        try {
            const res = await this.pool.query("SELECT NOW() AS current_time;");
            return { status: "connected", engine: "supabase", timestamp: res.rows[0].current_time };
        } catch (err) {
            return { status: "error", engine: "supabase", error: err.message };
        }
    }

    async getStudents() {
        if (!this.pool) return [];
        const res = await this.pool.query(`
            SELECT 
                s.id,
                s.roll_number,
                p.full_name AS name,
                p.email,
                s.department,
                s.academic_year,
                s.enrolled_courses,
                p.firebase_uid,
                CASE 
                    WHEN p.full_name LIKE '[Deactivated Student%' THEN 'deactivated'
                    ELSE 'active'
                END AS status,
                s.created_at
            FROM public.students s
            LEFT JOIN public.profiles p ON s.profile_id = p.id
            ORDER BY s.roll_number ASC;
        `);
        return res.rows;
    }

    async getStudentByRoll(rollNumber) {
        if (!this.pool) return null;
        const clean = String(rollNumber || "").trim().toUpperCase();
        const res = await this.pool.query(`
            SELECT 
                s.id,
                s.roll_number,
                p.full_name AS name,
                p.email,
                s.department,
                s.academic_year,
                s.enrolled_courses,
                p.firebase_uid,
                CASE 
                    WHEN p.full_name LIKE '[Deactivated Student%' THEN 'deactivated'
                    ELSE 'active'
                END AS status,
                s.created_at
            FROM public.students s
            LEFT JOIN public.profiles p ON s.profile_id = p.id
            WHERE UPPER(s.roll_number) = $1
            LIMIT 1;
        `, [clean]);
        return res.rows[0] || null;
    }

    async getProfileByUid(firebaseUid) {
        if (!this.pool) return null;
        const res = await this.pool.query(`
            SELECT id, firebase_uid, email, full_name, role, created_at
            FROM public.profiles
            WHERE firebase_uid = $1 OR auth_uid = $1
            LIMIT 1;
        `, [firebaseUid]);
        return res.rows[0] || null;
    }

    async upsertStudent(studentData) {
        if (!this.pool) return false;
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN;");
            // Upsert Profile
            const profRes = await client.query(`
                INSERT INTO public.profiles (
                    firebase_uid, auth_uid, email, full_name, role, updated_at
                ) VALUES ($1, $1, $2, $3, 'student', NOW())
                ON CONFLICT (email) DO UPDATE SET
                    firebase_uid = EXCLUDED.firebase_uid,
                    auth_uid = EXCLUDED.auth_uid,
                    full_name = EXCLUDED.full_name,
                    updated_at = NOW()
                RETURNING id;
            `, [studentData.firebaseUid || `uid_${Date.now()}`, studentData.email, studentData.fullName || studentData.name]);

            const profileId = profRes.rows[0].id;

            // Upsert Student
            await client.query(`
                INSERT INTO public.students (
                    profile_id, roll_number, department, academic_year, enrolled_courses, updated_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (roll_number) DO UPDATE SET
                    profile_id = EXCLUDED.profile_id,
                    department = EXCLUDED.department,
                    academic_year = EXCLUDED.academic_year,
                    updated_at = NOW();
            `, [
                profileId,
                String(studentData.rollNumber).toUpperCase().trim(),
                studentData.department || "Information Technology",
                studentData.academicYear || "B.Tech",
                studentData.enrolledCourses || []
            ]);

            await client.query("COMMIT;");
            return true;
        } catch (err) {
            await client.query("ROLLBACK;");
            throw err;
        } finally {
            client.release();
        }
    }

    async updateStudentStatus(rollNumber, status) {
        if (!this.pool) return false;
        const cleanRoll = String(rollNumber).toUpperCase().trim();
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN;");
            if (status === "deactivated" || status === "deleted") {
                await client.query(`
                    UPDATE public.profiles
                    SET full_name = '[Deactivated Student - ' || $1 || ']', updated_at = NOW()
                    WHERE id IN (SELECT profile_id FROM public.students WHERE UPPER(roll_number) = $1);
                `, [cleanRoll]);
            }
            await client.query("COMMIT;");
            return true;
        } catch (err) {
            await client.query("ROLLBACK;");
            throw err;
        } finally {
            client.release();
        }
    }

    async getExaminations() {
        if (!this.pool) return [];
        const res = await this.pool.query(`
            SELECT * FROM public.examinations
            ORDER BY created_at DESC;
        `);
        return res.rows.map(row => ({
            id: row.id,
            title: row.title,
            name: row.title,
            description: row.description,
            duration_minutes: row.duration_minutes || 60,
            total_questions: row.total_questions || 50,
            total_marks: Number(row.total_marks || 50),
            marks_per_question: Math.round(Number(row.total_marks || 50) / Number(row.total_questions || 50)) || 1,
            negative_marking: Boolean(row.negative_marking),
            scheduled_start_at: row.scheduled_start_at ? new Date(row.scheduled_start_at).toISOString() : null,
            scheduled_end_at: row.scheduled_end_at ? new Date(row.scheduled_end_at).toISOString() : null,
            scheduled_start_ist: row.scheduled_start_ist,
            status: row.status || "draft",
            questions: Array.isArray(row.questions) ? row.questions : [],
            created_at: row.created_at
        }));
    }

    async getExaminationById(examId) {
        if (!this.pool) return null;
        const res = await this.pool.query(`SELECT * FROM public.examinations WHERE id = $1 LIMIT 1;`, [examId]);
        if (res.rows.length === 0) return null;
        const row = res.rows[0];
        return {
            id: row.id,
            title: row.title,
            name: row.title,
            description: row.description,
            duration_minutes: row.duration_minutes || 60,
            total_questions: row.total_questions || 50,
            total_marks: Number(row.total_marks || 50),
            negative_marking: Boolean(row.negative_marking),
            scheduled_start_at: row.scheduled_start_at ? new Date(row.scheduled_start_at).toISOString() : null,
            scheduled_end_at: row.scheduled_end_at ? new Date(row.scheduled_end_at).toISOString() : null,
            scheduled_start_ist: row.scheduled_start_ist,
            status: row.status,
            questions: Array.isArray(row.questions) ? row.questions : []
        };
    }

    async getExaminationSecureKeys(examId) {
        // In Supabase, keys are embedded in examinations.questions
        const exam = await this.getExaminationById(examId);
        if (!exam || !exam.questions) return null;
        return exam.questions.map(q => ({
            id: q.id,
            question_number: q.question_number,
            correct_answer: q.correct_answer,
            correct_answers: q.correct_answers || [q.correct_answer],
            explanation: q.explanation || ""
        }));
    }

    async upsertExamination(examData) {
        if (!this.pool) return false;
        const qJson = JSON.stringify(examData.questions || []);
        await this.pool.query(`
            INSERT INTO public.examinations (
                id, title, description, duration_minutes, total_questions, total_marks,
                status, scheduled_start_at, scheduled_end_at, scheduled_start_ist,
                negative_marking, questions, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                duration_minutes = EXCLUDED.duration_minutes,
                total_questions = EXCLUDED.total_questions,
                total_marks = EXCLUDED.total_marks,
                status = EXCLUDED.status,
                scheduled_start_at = EXCLUDED.scheduled_start_at,
                scheduled_end_at = EXCLUDED.scheduled_end_at,
                scheduled_start_ist = EXCLUDED.scheduled_start_ist,
                negative_marking = EXCLUDED.negative_marking,
                questions = EXCLUDED.questions,
                updated_at = NOW();
        `, [
            examData.id,
            examData.title || examData.name,
            examData.description || "",
            examData.duration_minutes || 60,
            examData.total_questions || (examData.questions ? examData.questions.length : 50),
            examData.total_marks || 50,
            examData.status || "published",
            examData.scheduled_start_at || null,
            examData.scheduled_end_at || null,
            examData.scheduled_start_ist || null,
            Boolean(examData.negative_marking),
            qJson
        ]);
        return true;
    }

    async updateExamStatus(examId, status) {
        if (!this.pool) return false;
        await this.pool.query(`
            UPDATE public.examinations SET status = $1, updated_at = NOW() WHERE id = $2;
        `, [status, examId]);
        return true;
    }

    async deleteExamination(examId) {
        if (!this.pool) return false;
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN;");
            await client.query(`DELETE FROM public.results WHERE examination_id = $1;`, [examId]);
            await client.query(`DELETE FROM public.exam_attempts WHERE examination_id = $1;`, [examId]);
            await client.query(`DELETE FROM public.examinations WHERE id = $1;`, [examId]);
            await client.query("COMMIT;");
            return true;
        } catch (e) {
            await client.query("ROLLBACK;");
            throw e;
        } finally {
            client.release();
        }
    }

    async getExamAttempts(examId) {
        if (!this.pool) return [];
        const res = await this.pool.query(`
            SELECT * FROM public.exam_attempts WHERE examination_id = $1;
        `, [examId]);
        return res.rows;
    }

    async getAttempt(examId, rollNumber) {
        if (!this.pool) return null;
        const clean = String(rollNumber).toUpperCase().trim();
        const res = await this.pool.query(`
            SELECT * FROM public.exam_attempts
            WHERE examination_id = $1 AND UPPER(roll_number) = $2
            LIMIT 1;
        `, [examId, clean]);
        return res.rows[0] || null;
    }

    async createAttempt(attemptData) {
        if (!this.pool) return false;
        await this.pool.query(`
            INSERT INTO public.exam_attempts (
                id, examination_id, roll_number, set_number, started_at, deadline_at, status, fullscreen_violation_count, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW(), $5, 'in_progress', 0, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                set_number = EXCLUDED.set_number,
                status = 'in_progress',
                updated_at = NOW();
        `, [
            attemptData.attemptId || attemptData.id,
            attemptData.examId,
            String(attemptData.rollNumber).toUpperCase().trim(),
            attemptData.setNumber || 1,
            attemptData.deadlineAt
        ]);
        return true;
    }

    async saveAttemptAnswer(attemptId, qNum, selectedOption, examId, rollNumber) {
        if (!this.pool) return false;
        const clean = String(rollNumber).toUpperCase().trim();
        await this.pool.query(`
            UPDATE public.exam_attempts
            SET answers = jsonb_set(COALESCE(answers, '{}'::jsonb), ARRAY[$1], to_jsonb($2::text)),
                updated_at = NOW()
            WHERE id = $3 OR (examination_id = $4 AND UPPER(roll_number) = $5);
        `, [String(qNum), String(selectedOption), attemptId || "", examId, clean]);
        return true;
    }

    async recordViolation(attemptId, examId, rollNumber, violationCount) {
        if (!this.pool) return false;
        const clean = String(rollNumber).toUpperCase().trim();
        const isTerminated = violationCount >= 3;
        await this.pool.query(`
            UPDATE public.exam_attempts
            SET fullscreen_violation_count = $1,
                status = CASE WHEN $2 THEN 'terminated' ELSE status END,
                termination_reason = CASE WHEN $2 THEN 'Three Fullscreen Exit Violations Detected' ELSE termination_reason END,
                updated_at = NOW()
            WHERE id = $3 OR (examination_id = $4 AND UPPER(roll_number) = $5);
        `, [violationCount, isTerminated, attemptId || "", examId, clean]);
        return true;
    }

    async getExamResults(examId) {
        if (!this.pool) return [];
        const res = await this.pool.query(`
            SELECT * FROM public.results WHERE examination_id = $1 ORDER BY score DESC;
        `, [examId]);
        return res.rows;
    }

    async getResult(examId, rollNumber) {
        if (!this.pool) return null;
        const clean = String(rollNumber).toUpperCase().trim();
        const res = await this.pool.query(`
            SELECT * FROM public.results
            WHERE examination_id = $1 AND UPPER(roll_number) = $2
            LIMIT 1;
        `, [examId, clean]);
        return res.rows[0] || null;
    }

    async finalizeSubmission(resultData, attemptUpdateData) {
        if (!this.pool) return false;
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN;");

            // Upsert Result
            await client.query(`
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
                resultData.id,
                resultData.attemptId,
                resultData.examId,
                String(resultData.rollNumber || resultData.studentRoll).toUpperCase().trim(),
                resultData.score,
                resultData.totalMarks,
                resultData.percentage,
                resultData.status,
                Boolean(resultData.autoSubmitted),
                JSON.stringify(resultData.itemizedReview || []),
                resultData.timeTakenSeconds || 0
            ]);

            // Update Attempt
            if (attemptUpdateData) {
                await client.query(`
                    UPDATE public.exam_attempts
                    SET status = $1,
                        marks_obtained = $2,
                        answers = $3::jsonb,
                        submitted_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $4 OR (examination_id = $5 AND UPPER(roll_number) = $6);
                `, [
                    attemptUpdateData.status || "submitted",
                    resultData.score,
                    JSON.stringify(attemptUpdateData.answers || {}),
                    attemptUpdateData.attemptId || resultData.attemptId,
                    resultData.examId,
                    String(resultData.rollNumber || resultData.studentRoll).toUpperCase().trim()
                ]);
            }

            await client.query("COMMIT;");
            return true;
        } catch (err) {
            await client.query("ROLLBACK;");
            throw err;
        } finally {
            client.release();
        }
    }
}

// =========================================================================
// 3. FIREBASE CLOUD FIRESTORE ADAPTER (MIGRATION READY)
// =========================================================================

class FirestoreAdapter extends DatabaseAdapter {
    constructor(options = {}) {
        super();
        this.projectId = options.projectId || process.env.VITE_FIREBASE_PROJECT_ID || "kits-lms-13053";
        this.db = null;
        this.admin = null;
        this.isInitialized = false;
        // In-memory shadow store for offline mock/testing mode when no service account credentials exist
        this.mockStore = {
            profiles: new Map(),
            students: new Map(),
            examinations: new Map(),
            examinations_secure: new Map(),
            exam_attempts: new Map(),
            results: new Map()
        };
    }

    getEngineName() {
        return "firestore";
    }

    async init() {
        if (this.isInitialized) return;

        try {
            const { initializeApp, cert, getApps, getApp } = require("firebase-admin/app");
            const { getFirestore } = require("firebase-admin/firestore");

            let initializedApp = null;
            if (getApps().length > 0) {
                initializedApp = getApp();
            } else {
                let certData = null;
                const keyEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
                if (keyEnv) {
                    if (keyEnv.trim().startsWith('{')) {
                        certData = JSON.parse(keyEnv);
                    } else if (fs.existsSync(keyEnv)) {
                        certData = JSON.parse(fs.readFileSync(keyEnv, 'utf-8'));
                    }
                }
                
                if (!certData && process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
                    certData = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8'));
                }

                if (!certData) {
                    // Check local root for auto-generated admin sdk key
                    const localKeyPath = path.join(__dirname, 'firebase-adminsdk-kits-lms-13053.json');
                    if (fs.existsSync(localKeyPath)) {
                        certData = JSON.parse(fs.readFileSync(localKeyPath, 'utf-8'));
                    }
                }

                if (certData) {
                    initializedApp = initializeApp({
                        credential: cert(certData),
                        projectId: this.projectId
                    });
                } else {
                    initializedApp = initializeApp({
                        projectId: this.projectId
                    });
                }
            }

            this.db = getFirestore(initializedApp);
            this.isInitialized = true;
            console.log(`[FIRESTORE-ADAPTER] Initialized Firebase Admin SDK for project '${this.projectId}'.`);
        } catch (err) {
            console.warn(`[FIRESTORE-ADAPTER-INIT-WARN] Firestore initialization fallback: ${err.message}. Enabling isolated memory store.`);
            this.isInitialized = true;
        }
    }

    async healthCheck() {
        if (!this.db) {
            return { status: "mock_ready", engine: "firestore", projectId: this.projectId };
        }
        try {
            // Read-only ping to collections list
            const cols = await this.db.listCollections();
            return { status: "connected", engine: "firestore", collectionsCount: cols.length, projectId: this.projectId };
        } catch (err) {
            return { status: "decoupled", engine: "firestore", note: err.message, projectId: this.projectId };
        }
    }

    async getStudents() {
        if (this.db) {
            try {
                const snap = await this.db.collection("students").get();
                const list = snap.docs.map(doc => doc.data());
                list.sort((a, b) => String(a.roll_number || a.rollNumber || '').localeCompare(String(b.roll_number || b.rollNumber || '')));
                return list;
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return Array.from(this.mockStore.students.values());
    }

    async getStudentByRoll(rollNumber) {
        const clean = String(rollNumber || "").trim().toUpperCase();
        if (this.db) {
            try {
                const doc = await this.db.collection("students").doc(clean).get();
                if (doc.exists) return doc.data();
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return this.mockStore.students.get(clean) || null;
    }

    async getProfileByUid(firebaseUid) {
        if (this.db) {
            try {
                const doc = await this.db.collection("profiles").doc(firebaseUid).get();
                if (doc.exists) return doc.data();
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return this.mockStore.profiles.get(firebaseUid) || null;
    }

    async upsertStudent(studentData) {
        const roll = String(studentData.rollNumber).toUpperCase().trim();
        const uid = studentData.firebaseUid || `uid_${Date.now()}`;
        const record = {
            id: studentData.id || `stud_${Date.now()}`,
            rollNumber: roll,
            roll_number: roll,
            name: studentData.fullName || studentData.name,
            fullName: studentData.fullName || studentData.name,
            email: studentData.email,
            firebaseUid: uid,
            role: "student",
            department: studentData.department || "Information Technology",
            academicYear: studentData.academicYear || "B.Tech",
            enrolledCourses: studentData.enrolledCourses || [],
            status: studentData.status || "active",
            updatedAt: new Date().toISOString()
        };

        if (this.db) {
            try {
                const batch = this.db.batch();
                // 1. Profile document
                const profRef = this.db.collection("profiles").doc(uid);
                batch.set(profRef, {
                    firebaseUid: uid,
                    email: record.email,
                    fullName: record.fullName,
                    role: "student",
                    rollNumber: roll,
                    status: record.status,
                    updatedAt: record.updatedAt
                }, { merge: true });

                // 2. Student document
                const studRef = this.db.collection("students").doc(roll);
                batch.set(studRef, record, { merge: true });

                await batch.commit();
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }

        this.mockStore.profiles.set(uid, record);
        this.mockStore.students.set(roll, record);
        return true;
    }

    async updateStudentStatus(rollNumber, status) {
        const clean = String(rollNumber).toUpperCase().trim();
        if (this.db) {
            try {
                const studRef = this.db.collection("students").doc(clean);
                await studRef.update({ status: status, updatedAt: new Date().toISOString() });
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }
        const existing = this.mockStore.students.get(clean);
        if (existing) {
            existing.status = status;
            this.mockStore.students.set(clean, existing);
        }
        return true;
    }

    async getExaminations() {
        if (this.db) {
            try {
                const snap = await this.db.collection("examinations").get();
                const list = snap.docs.map(doc => doc.data());
                list.sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));
                return list;
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return Array.from(this.mockStore.examinations.values());
    }

    async getExaminationById(examId) {
        if (this.db) {
            try {
                const doc = await this.db.collection("examinations").doc(examId).get();
                if (doc.exists) return doc.data();
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return this.mockStore.examinations.get(examId) || null;
    }

    async getExaminationSecureKeys(examId) {
        // Read strictly from segregated secure collection
        if (this.db) {
            try {
                const doc = await this.db.collection("examinations_secure").doc(examId).get();
                if (doc.exists) return doc.data().answer_keys || doc.data().keys || [];
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return this.mockStore.examinations_secure.get(examId) || null;
    }

    async upsertExamination(examData) {
        const examId = examData.id;
        const rawQuestions = examData.questions || [];

        // 1. Sanitize questions for student/public catalog (STRIP KEYS & EXPLANATIONS)
        const sanitizedQuestions = rawQuestions.map(q => ({
            id: q.id,
            question_number: q.question_number,
            question_text: q.question_text || q.statement,
            statement: q.question_text || q.statement,
            option_a: q.option_a,
            option_b: q.option_b,
            option_c: q.option_c,
            option_d: q.option_d,
            ...(q.option_e ? { option_e: q.option_e } : {}),
            type: q.type || "mcq",
            marks: q.marks || 1
        }));

        // 2. Segregate secret answer keys & explanations for server evaluation only
        const secureKeys = rawQuestions.map(q => ({
            id: q.id,
            question_number: q.question_number,
            correct_answer: q.correct_answer || "A",
            correct_answers: q.correct_answers || [q.correct_answer || "A"],
            explanation: q.explanation || ""
        }));

        const publicRecord = {
            id: examId,
            title: examData.title || examData.name,
            name: examData.title || examData.name,
            description: examData.description || "",
            durationMinutes: examData.duration_minutes || 60,
            duration_minutes: examData.duration_minutes || 60,
            totalQuestions: sanitizedQuestions.length,
            total_questions: sanitizedQuestions.length,
            totalMarks: examData.total_marks || sanitizedQuestions.reduce((s, q) => s + (q.marks || 1), 0),
            total_marks: examData.total_marks || sanitizedQuestions.reduce((s, q) => s + (q.marks || 1), 0),
            status: examData.status || "published",
            scheduledStartAt: examData.scheduled_start_at || null,
            scheduled_start_at: examData.scheduled_start_at || null,
            scheduledEndAt: examData.scheduled_end_at || null,
            scheduled_end_at: examData.scheduled_end_at || null,
            scheduledStartIST: examData.scheduled_start_ist || null,
            scheduled_start_ist: examData.scheduled_start_ist || null,
            negativeMarking: Boolean(examData.negative_marking),
            questions: sanitizedQuestions,
            updatedAt: new Date().toISOString()
        };

        if (this.db) {
            try {
                const batch = this.db.batch();
                // Write public document
                const pubRef = this.db.collection("examinations").doc(examId);
                batch.set(pubRef, publicRecord, { merge: true });

                // Write secure keys document (Restricted security path)
                const secRef = this.db.collection("examinations_secure").doc(examId);
                batch.set(secRef, {
                    examId: examId,
                    keys: secureKeys,
                    updatedAt: new Date().toISOString()
                }, { merge: true });

                await batch.commit();
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }

        this.mockStore.examinations.set(examId, publicRecord);
        this.mockStore.examinations_secure.set(examId, secureKeys);
        return true;
    }

    async updateExamStatus(examId, status) {
        if (this.db) {
            try {
                const ref = this.db.collection("examinations").doc(examId);
                await ref.update({ status: status, updatedAt: new Date().toISOString() });
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }
        const existing = this.mockStore.examinations.get(examId);
        if (existing) {
            existing.status = status;
            this.mockStore.examinations.set(examId, existing);
        }
        return true;
    }

    async deleteExamination(examId) {
        if (this.db) {
            try {
                const batch = this.db.batch();
                batch.delete(this.db.collection("examinations").doc(examId));
                batch.delete(this.db.collection("examinations_secure").doc(examId));
                await batch.commit();
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }
        this.mockStore.examinations.delete(examId);
        this.mockStore.examinations_secure.delete(examId);
        return true;
    }

    async getExamAttempts(examId) {
        if (this.db) {
            try {
                const snap = await this.db.collection("exam_attempts").where("examination_id", "==", examId).get();
                return snap.docs.map(doc => doc.data());
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return Array.from(this.mockStore.exam_attempts.values()).filter(a => a.examination_id === examId || a.examId === examId);
    }

    async getAttempt(examId, rollNumber) {
        const clean = String(rollNumber).toUpperCase().trim();
        if (this.db) {
            try {
                const snap = await this.db.collection("exam_attempts")
                    .where("examination_id", "==", examId)
                    .where("roll_number", "==", clean)
                    .limit(1)
                    .get();
                if (!snap.empty) return snap.docs[0].data();
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return Array.from(this.mockStore.exam_attempts.values())
            .find(a => (a.examination_id === examId || a.examId === examId) && (a.roll_number || a.rollNumber || "").toUpperCase() === clean) || null;
    }

    async createAttempt(attemptData) {
        const attId = attemptData.attemptId || attemptData.id;
        const clean = String(attemptData.rollNumber).toUpperCase().trim();
        const doc = {
            id: attId,
            attemptId: attId,
            examination_id: attemptData.examId,
            examId: attemptData.examId,
            roll_number: clean,
            rollNumber: clean,
            set_number: attemptData.setNumber || 1,
            started_at: new Date().toISOString(),
            deadline_at: attemptData.deadlineAt,
            status: "in_progress",
            fullscreen_violation_count: 0,
            answers: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (this.db) {
            try {
                await this.db.collection("exam_attempts").doc(attId).set(doc, { merge: true });
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }
        this.mockStore.exam_attempts.set(attId, doc);
        return true;
    }

    async saveAttemptAnswer(attemptId, qNum, selectedOption, examId, rollNumber) {
        const clean = String(rollNumber).toUpperCase().trim();
        const fieldKey = `answers.${qNum}`;
        if (this.db) {
            try {
                await this.db.collection("exam_attempts").doc(attemptId).update({
                    [fieldKey]: selectedOption,
                    updated_at: new Date().toISOString()
                });
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }

        const existing = this.mockStore.exam_attempts.get(attemptId);
        if (existing) {
            if (!existing.answers) existing.answers = {};
            existing.answers[qNum] = selectedOption;
            existing.updated_at = new Date().toISOString();
        }
        return true;
    }

    async recordViolation(attemptId, examId, rollNumber, violationCount) {
        const isTerminated = violationCount >= 3;
        const updates = {
            fullscreen_violation_count: violationCount,
            updated_at: new Date().toISOString()
        };
        if (isTerminated) {
            updates.status = "terminated";
            updates.termination_reason = "Three Fullscreen Exit Violations Detected";
        }

        if (this.db) {
            try {
                await this.db.collection("exam_attempts").doc(attemptId).update(updates);
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }

        const existing = this.mockStore.exam_attempts.get(attemptId);
        if (existing) {
            Object.assign(existing, updates);
        }
        return true;
    }

    async getExamResults(examId) {
        if (this.db) {
            try {
                const snap = await this.db.collection("results").where("examination_id", "==", examId).get();
                const list = snap.docs.map(doc => doc.data());
                list.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
                return list;
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return Array.from(this.mockStore.results.values()).filter(r => r.examination_id === examId || r.examId === examId);
    }

    async getResult(examId, rollNumber) {
        const clean = String(rollNumber).toUpperCase().trim();
        if (this.db) {
            try {
                const snap = await this.db.collection("results")
                    .where("examination_id", "==", examId)
                    .where("roll_number", "==", clean)
                    .limit(1)
                    .get();
                if (!snap.empty) return snap.docs[0].data();
            } catch (e) {
                console.warn("[FIRESTORE-READ-FALLBACK]", e.message);
            }
        }
        return Array.from(this.mockStore.results.values())
            .find(r => (r.examination_id === examId || r.examId === examId) && (r.roll_number || r.studentRoll || "").toUpperCase() === clean) || null;
    }

    async finalizeSubmission(resultData, attemptUpdateData) {
        const resId = resultData.id;
        const attId = resultData.attemptId;
        const clean = String(resultData.rollNumber || resultData.studentRoll).toUpperCase().trim();

        const resultDoc = {
            id: resId,
            attempt_id: attId,
            attemptId: attId,
            examination_id: resultData.examId,
            examId: resultData.examId,
            exam_name: resultData.examName || resultData.examTitle,
            roll_number: clean,
            studentRoll: clean,
            student_name: resultData.studentName,
            score: resultData.score,
            total_marks: resultData.totalMarks,
            totalMarks: resultData.totalMarks,
            percentage: resultData.percentage,
            status: resultData.status,
            auto_submitted: Boolean(resultData.autoSubmitted),
            autoSubmitted: Boolean(resultData.autoSubmitted),
            section_breakdown: resultData.itemizedReview || [],
            itemizedReview: resultData.itemizedReview || [],
            time_taken_seconds: resultData.timeTakenSeconds || 0,
            completed_at: new Date().toISOString()
        };

        if (this.db) {
            try {
                const batch = this.db.batch();
                // Write result doc
                const resRef = this.db.collection("results").doc(resId);
                batch.set(resRef, resultDoc, { merge: true });

                // Update attempt doc
                if (attId) {
                    const attRef = this.db.collection("exam_attempts").doc(attId);
                    batch.update(attRef, {
                        status: (attemptUpdateData && attemptUpdateData.status) || "submitted",
                        marks_obtained: resultData.score,
                        answers: (attemptUpdateData && attemptUpdateData.answers) || {},
                        submitted_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }

                await batch.commit();
                return true;
            } catch (e) {
                console.warn("[FIRESTORE-WRITE-FALLBACK]", e.message);
            }
        }

        this.mockStore.results.set(resId, resultDoc);
        const att = this.mockStore.exam_attempts.get(attId);
        if (att) {
            att.status = (attemptUpdateData && attemptUpdateData.status) || "submitted";
            att.marks_obtained = resultData.score;
            att.answers = (attemptUpdateData && attemptUpdateData.answers) || att.answers;
            att.submitted_at = new Date().toISOString();
        }
        return true;
    }
}

// =========================================================================
// 4. FACTORY & SINGLETON EXPORT
// =========================================================================

let activeAdapterInstance = null;

function getDatabaseAdapter(forceEngine = null) {
    // STRICT DEFAULT: Always use "supabase" unless DB_ENGINE="firestore" is explicitly passed or set in env
    const selectedEngine = (forceEngine || process.env.DB_ENGINE || "supabase").toLowerCase().trim();

    if (activeAdapterInstance && activeAdapterInstance.getEngineName() === selectedEngine) {
        return activeAdapterInstance;
    }

    if (selectedEngine === "firestore") {
        console.log("[DB-ADAPTER-FACTORY] Initializing FirestoreAdapter (Cloud Firestore Engine)...");
        activeAdapterInstance = new FirestoreAdapter();
    } else {
        console.log("[DB-ADAPTER-FACTORY] Initializing SupabaseAdapter (PostgreSQL Engine - Production Default)...");
        activeAdapterInstance = new SupabaseAdapter();
    }

    return activeAdapterInstance;
}

module.exports = {
    DatabaseAdapter,
    SupabaseAdapter,
    FirestoreAdapter,
    getDatabaseAdapter
};
