const path = require('path');
const fs = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

async function run() {
    console.log('==================================================================');
    console.log('  KITS LMS — COMPREHENSIVE SUPABASE -> FIRESTORE MIGRATION');
    console.log('==================================================================');

    // 1. Initialize Firebase Admin SDK
    const keyPath = path.join(__dirname, '..', 'firebase-adminsdk-kits-lms-13053.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    const app = getApps().length > 0 ? getApps()[0] : initializeApp({
        credential: cert(serviceAccount),
        projectId: 'kits-lms-13053'
    });
    const db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });

    // 2. Load latest backup
    const backupDir = path.join(__dirname, '..', 'backups');
    const subDirs = fs.readdirSync(backupDir).filter(f => f.startsWith('comprehensive_backup_')).sort().reverse();
    if (subDirs.length === 0) throw new Error('No comprehensive backup found');
    const dumpDir = path.join(backupDir, subDirs[0]);
    const files = fs.readdirSync(dumpDir).filter(f => f.startsWith('supabase_full_dump_'));
    const sbDump = JSON.parse(fs.readFileSync(path.join(dumpDir, files[0]), 'utf8'));

    const sourceProfiles = sbDump.tables.profiles || [];
    const sourceStudents = sbDump.tables.students || [];
    const sourceExams = sbDump.tables.examinations || [];
    const sourceAttempts = sbDump.tables.exam_attempts || [];
    const sourceResults = sbDump.tables.results || [];

    console.log(`Source records in backup:`);
    console.log(`- Profiles: ${sourceProfiles.length}`);
    console.log(`- Students: ${sourceStudents.length}`);
    console.log(`- Examinations: ${sourceExams.length}`);
    console.log(`- Exam Attempts: ${sourceAttempts.length}`);
    console.log(`- Results: ${sourceResults.length}`);

    // Map profiles by id
    const profileById = new Map();
    for (const p of sourceProfiles) {
        profileById.set(p.id, p);
    }

    let batch = db.batch();
    let opCount = 0;
    const MAX_BATCH = 250;

    async function stage(docRef, data) {
        batch.set(docRef, JSON.parse(JSON.stringify(data)), { merge: true });
        opCount++;
        if (opCount >= MAX_BATCH) {
            await batch.commit();
            console.log(`  Committed batch of ${opCount} writes.`);
            batch = db.batch();
            opCount = 0;
        }
    }

    async function flush() {
        if (opCount > 0) {
            await batch.commit();
            console.log(`  Flushed final batch of ${opCount} writes.`);
            batch = db.batch();
            opCount = 0;
        }
    }

    // 3. Migrate Profiles
    console.log('\n--- 1. Migrating Profiles ---');
    for (const p of sourceProfiles) {
        const uid = p.firebase_uid || p.auth_uid || p.id;
        const ref = db.collection('profiles').doc(uid);
        await stage(ref, {
            id: p.id,
            firebase_uid: p.firebase_uid || null,
            auth_uid: p.auth_uid || p.firebase_uid || null,
            email: p.email || '',
            full_name: p.full_name || '',
            name: p.full_name || '',
            role: p.role || 'student',
            avatar_url: p.avatar_url || null,
            created_at: p.created_at || new Date().toISOString(),
            updated_at: p.updated_at || new Date().toISOString()
        });
    }
    await flush();

    // 4. Migrate Students
    console.log('\n--- 2. Migrating Students ---');
    for (const s of sourceStudents) {
        const roll = String(s.roll_number || '').trim().toUpperCase();
        if (!roll) continue;
        const p = profileById.get(s.profile_id) || {};
        const isDeactivated = (p.full_name || '').startsWith('[Deactivated Student');
        const status = isDeactivated ? 'deactivated' : 'active';
        const uid = p.firebase_uid || p.auth_uid || `uid_${roll}`;

        const ref = db.collection('students').doc(roll);
        await stage(ref, {
            id: s.id,
            profile_id: s.profile_id,
            roll_number: roll,
            rollNumber: roll,
            name: p.full_name || `Student ${roll}`,
            fullName: p.full_name || `Student ${roll}`,
            email: p.email || `${roll.toLowerCase()}@kits.edu.in`,
            firebaseUid: uid,
            department: s.department || 'Information Technology',
            academic_year: s.academic_year || '2nd Year B.Tech (2026-27)',
            academicYear: s.academic_year || '2nd Year B.Tech (2026-27)',
            branch: s.department || 'Information Technology',
            batch: '2026-27',
            enrolled_courses: s.enrolled_courses || [],
            enrolledCourses: s.enrolled_courses || [],
            status: status,
            created_at: s.created_at || new Date().toISOString(),
            updated_at: s.updated_at || new Date().toISOString()
        });
    }
    await flush();

    // 5. Migrate Examinations & Secure Keys
    console.log('\n--- 3. Migrating Examinations & Secure Keys ---');
    for (const e of sourceExams) {
        const examId = e.id;
        let questions = [];
        if (e.questions) {
            questions = typeof e.questions === 'string' ? JSON.parse(e.questions) : e.questions;
        }

        // Standardize questions
        const sanitizedQuestions = questions.map((q, idx) => ({
            id: q.id || `q_${idx + 1}`,
            question_number: q.question_number || idx + 1,
            question_text: q.question_text || q.statement || '',
            statement: q.question_text || q.statement || '',
            option_a: q.option_a || '',
            option_b: q.option_b || '',
            option_c: q.option_c || '',
            option_d: q.option_d || '',
            ...(q.option_e ? { option_e: q.option_e } : {}),
            type: q.type || 'mcq',
            marks: q.marks || 1
        }));

        const secureKeys = questions.map((q, idx) => ({
            id: q.id || `q_${idx + 1}`,
            question_number: q.question_number || idx + 1,
            correct_answer: q.correct_answer || 'A',
            correct_answers: q.correct_answers || [q.correct_answer || 'A'],
            explanation: q.explanation || ''
        }));

        const pubRef = db.collection('examinations').doc(examId);
        await stage(pubRef, {
            id: examId,
            course_id: e.course_id || null,
            title: e.title,
            name: e.title,
            description: e.description || '',
            total_marks: Number(e.total_marks) || 50,
            totalMarks: Number(e.total_marks) || 50,
            duration_minutes: Number(e.duration_minutes) || 60,
            durationMinutes: Number(e.duration_minutes) || 60,
            total_questions: sanitizedQuestions.length || Number(e.total_questions) || 50,
            totalQuestions: sanitizedQuestions.length || Number(e.total_questions) || 50,
            status: e.status || 'published',
            scheduled_start_at: e.scheduled_start_at || null,
            scheduledStartAt: e.scheduled_start_at || null,
            scheduled_end_at: e.scheduled_end_at || null,
            scheduledEndAt: e.scheduled_end_at || null,
            scheduled_start_ist: e.scheduled_start_ist || null,
            negative_marking: Boolean(e.negative_marking),
            negativeMarking: Boolean(e.negative_marking),
            questions: sanitizedQuestions,
            created_at: e.created_at || new Date().toISOString(),
            updated_at: e.updated_at || new Date().toISOString()
        });

        const secRef = db.collection('examinations_secure').doc(examId);
        await stage(secRef, {
            examId: examId,
            keys: secureKeys,
            answer_keys: secureKeys,
            updatedAt: new Date().toISOString()
        });
    }
    await flush();

    // 6. Migrate Attempts
    console.log('\n--- 4. Migrating Exam Attempts ---');
    for (const a of sourceAttempts) {
        const attId = a.id;
        const ref = db.collection('exam_attempts').doc(attId);
        await stage(ref, {
            id: attId,
            examId: a.examination_id,
            exam_id: a.examination_id,
            rollNumber: a.roll_number,
            roll_number: a.roll_number,
            student_id: a.student_id || null,
            setNumber: a.set_number || 1,
            set_number: a.set_number || 1,
            status: a.status || 'submitted',
            startedAt: a.started_at,
            started_at: a.started_at,
            submittedAt: a.submitted_at,
            submitted_at: a.submitted_at,
            total_time_seconds: Number(a.total_time_seconds) || 0,
            score: Number(a.total_score) || Number(a.marks_obtained) || 0,
            marks_obtained: Number(a.marks_obtained) || Number(a.total_score) || 0,
            answers: a.answers || {},
            terms_accepted: Boolean(a.terms_accepted),
            fullscreen_violation_count: Number(a.fullscreen_violation_count) || 0,
            created_at: a.created_at || new Date().toISOString(),
            updated_at: a.updated_at || new Date().toISOString()
        });
    }
    await flush();

    // 7. Migrate Results
    console.log('\n--- 5. Migrating Results ---');
    for (const r of sourceResults) {
        const resId = r.id;
        const ref = db.collection('results').doc(resId);
        await stage(ref, {
            id: resId,
            attemptId: r.attempt_id,
            attempt_id: r.attempt_id,
            examId: r.examination_id,
            exam_id: r.examination_id,
            rollNumber: r.roll_number,
            roll_number: r.roll_number,
            score: Number(r.score) || 0,
            totalMarks: Number(r.total_marks) || 50,
            total_marks: Number(r.total_marks) || 50,
            percentage: Number(r.percentage) || 0,
            status: r.status || 'Pass',
            sectionBreakdown: r.section_breakdown || [],
            section_breakdown: r.section_breakdown || [],
            timeTakenSeconds: Number(r.time_taken_seconds) || 0,
            completedAt: r.completed_at || new Date().toISOString(),
            completed_at: r.completed_at || new Date().toISOString(),
            created_at: r.created_at || new Date().toISOString()
        });
    }
    await flush();

    // 8. Reconciliation verification
    console.log('\n==================================================================');
    console.log('  RECONCILIATION VERIFICATION');
    console.log('==================================================================');

    const sSnap = await db.collection('students').get();
    const pSnap = await db.collection('profiles').get();
    const eSnap = await db.collection('examinations').get();
    const secSnap = await db.collection('examinations_secure').get();
    const aSnap = await db.collection('exam_attempts').get();
    const rSnap = await db.collection('results').get();

    const report = {
        timestamp: new Date().toISOString(),
        source: {
            profiles: sourceProfiles.length,
            students: sourceStudents.length,
            examinations: sourceExams.length,
            exam_attempts: sourceAttempts.length,
            results: sourceResults.length
        },
        destination: {
            profiles: pSnap.size,
            students: sSnap.size,
            examinations: eSnap.size,
            examinations_secure: secSnap.size,
            exam_attempts: aSnap.size,
            results: rSnap.size
        },
        checks: {
            studentsCovered: sSnap.size >= sourceStudents.length,
            profilesCovered: pSnap.size >= sourceProfiles.length,
            examinationsCovered: eSnap.size >= sourceExams.length,
            attemptsCovered: aSnap.size >= sourceAttempts.length,
            resultsCovered: rSnap.size >= sourceResults.length
        }
    };

    console.log(JSON.stringify(report, null, 2));

    const repFile = path.join(dumpDir, 'migration_reconciliation_report.json');
    fs.writeFileSync(repFile, JSON.stringify(report, null, 2), 'utf8');
    const rootRepFile = path.join(backupDir, 'migration_reconciliation_report.json');
    fs.writeFileSync(rootRepFile, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[SUCCESS] Full migration and reconciliation complete! Report saved.`);
}

run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});

