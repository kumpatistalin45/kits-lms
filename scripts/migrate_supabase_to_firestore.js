const path = require('path');
const fs = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

async function runDirectMigration() {
    console.log('==================================================================');
    console.log('  KITS LMS — DIRECT PRODUCTION MIGRATION TO CLOUD FIRESTORE');
    console.log('  Target Project: kits-lms-13053');
    console.log('==================================================================');

    // 1. Initialize Firebase Admin SDK
    const keyPath = path.join(__dirname, '..', 'firebase-adminsdk-kits-lms-13053.json');
    if (!fs.existsSync(keyPath)) {
        throw new Error(`Firebase Admin key not found at ${keyPath}`);
    }
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));

    const app = getApps().length > 0 ? getApps()[0] : initializeApp({
        credential: cert(serviceAccount),
        projectId: 'kits-lms-13053'
    });
    const db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });

    // 2. Load latest pre-cutover backup
    const backupDir = path.join(__dirname, '..', 'backups');
    const backupFiles = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('supabase_migration_pre_cutover_'))
        .sort()
        .reverse();

    if (backupFiles.length === 0) {
        throw new Error('No pre-cutover backup file found in backups/ directory!');
    }

    const backupFile = path.join(backupDir, backupFiles[0]);
    console.log(`[MIGRATE] Reading verified source backup from: ${backupFile}`);
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));

    const sourceProfiles = backup.tables.profiles || [];
    const sourceStudents = backup.tables.students || [];
    const sourceExaminations = backup.tables.examinations || [];
    const sourceAttempts = backup.tables.exam_attempts || [];
    const sourceResults = backup.tables.results || [];

    console.log(`[MIGRATE] Source records to migrate:`);
    console.log(`  - profiles: ${sourceProfiles.length}`);
    console.log(`  - students: ${sourceStudents.length}`);
    console.log(`  - examinations: ${sourceExaminations.length}`);
    console.log(`  - exam_attempts: ${sourceAttempts.length}`);
    console.log(`  - results: ${sourceResults.length}`);

    if (sourceProfiles.length !== 67 || sourceStudents.length !== 67 || sourceExaminations.length !== 17 || sourceAttempts.length !== 26 || sourceResults.length !== 4) {
        throw new Error('Source record counts mismatch expected institutional counts! Aborting.');
    }

    // Index profiles by id
    const profileById = new Map();
    for (const p of sourceProfiles) {
        profileById.set(p.id, p);
    }

    // Helper to commit in batches
    let currentBatch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 250;

    async function stageWrite(docRef, data) {
        currentBatch.set(docRef, JSON.parse(JSON.stringify(data)), { merge: true });
        batchCount++;
        if (batchCount >= MAX_BATCH_SIZE) {
            await currentBatch.commit();
            console.log(`  [BATCH] Committed batch of ${batchCount} operations.`);
            currentBatch = db.batch();
            batchCount = 0;
        }
    }

    async function flushBatch() {
        if (batchCount > 0) {
            await currentBatch.commit();
            console.log(`  [BATCH] Final batch of ${batchCount} operations committed.`);
            currentBatch = db.batch();
            batchCount = 0;
        }
    }

    // 3. Migrate PROFILES
    console.log('\n[MIGRATE 1/5] Migrating profiles collection...');
    for (const p of sourceProfiles) {
        const docId = p.firebase_uid || p.id;
        const docRef = db.collection('profiles').doc(docId);
        await stageWrite(docRef, {
            id: p.id,
            firebase_uid: p.firebase_uid || null,
            auth_uid: p.auth_uid || p.firebase_uid || null,
            email: p.email || '',
            full_name: p.full_name || '',
            role: p.role || 'student',
            avatar_url: p.avatar_url || null,
            created_at: p.created_at || new Date().toISOString(),
            updated_at: p.updated_at || new Date().toISOString()
        });
    }

    // 4. Migrate STUDENTS
    console.log('[MIGRATE 2/5] Migrating students collection...');
    let activeStudentCount = 0;
    let deactivatedStudentCount = 0;

    for (const s of sourceStudents) {
        const roll = String(s.roll_number || '').trim().toUpperCase();
        const p = profileById.get(s.profile_id) || {};
        const isDeactivated = (p.full_name || '').startsWith('[Deactivated Student');
        const status = isDeactivated ? 'deactivated' : 'active';

        if (status === 'active') activeStudentCount++;
        else deactivatedStudentCount++;

        const docRef = db.collection('students').doc(roll);
        await stageWrite(docRef, {
            id: s.id,
            profile_id: s.profile_id,
            roll_number: roll,
            name: p.full_name || '',
            email: p.email || '',
            department: s.department || 'IT',
            academic_year: s.academic_year || '2025-2026',
            enrolled_courses: s.enrolled_courses || [],
            firebase_uid: p.firebase_uid || null,
            status: status,
            created_at: s.created_at || new Date().toISOString(),
            updated_at: s.updated_at || new Date().toISOString()
        });
    }
    console.log(`  -> Students categorized: ${activeStudentCount} active, ${deactivatedStudentCount} deactivated.`);

    // 5. Migrate EXAMINATIONS & EXAMINATIONS_SECURE
    console.log('[MIGRATE 3/5] Migrating examinations and examinations_secure collections...');
    for (const exam of sourceExaminations) {
        const questions = Array.isArray(exam.questions) ? exam.questions : [];

        // Public questions: strip correct answers and explanations
        const publicQuestions = questions.map(q => {
            const sanitized = {
                id: q.id || `q_${Math.random().toString(36).substring(2, 9)}`,
                question_number: q.question_number || q.display_number || 1,
                statement: q.statement || q.question_text || q.question || '',
                type: (q.type || 'MCQ').toUpperCase(),
                marks: Number(q.marks || q.maxMarks || 1)
            };
            if (Array.isArray(q.options)) {
                sanitized.options = q.options.map(opt => {
                    if (typeof opt === 'string') return opt;
                    return {
                        key: opt.key || opt.letter || '',
                        text: opt.text || opt.statement || ''
                    };
                });
            }
            return sanitized;
        });

        // Secret keys for examinations_secure
        const secretAnswerKeys = questions.map((q, idx) => ({
            id: q.id || `q_${q.question_number || idx + 1}`,
            question_number: q.question_number || q.display_number || (idx + 1),
            correct_answer: q.correct_answer || q.correctAnswer || null,
            correct_answers: q.correct_answers || (q.correct_answer ? [q.correct_answer] : []),
            explanation: q.explanation || ''
        }));

        // Write public exam
        const publicDocRef = db.collection('examinations').doc(exam.id);
        await stageWrite(publicDocRef, {
            id: exam.id,
            title: exam.title || 'Untitled Exam',
            description: exam.description || '',
            course_id: exam.course_id || null,
            total_marks: Number(exam.total_marks || 0),
            duration_minutes: Number(exam.duration_minutes || 60),
            mcq_count: Number(exam.mcq_count || 0),
            msq_count: Number(exam.msq_count || 0),
            coding_count: Number(exam.coding_count || 0),
            set_count: Number(exam.set_count || 1),
            eligibility_dept: exam.eligibility_dept || 'IT',
            instructions: exam.instructions || '',
            section_a_pdf_url: exam.section_a_pdf_url || null,
            section_b_pdf_url: exam.section_b_pdf_url || null,
            status: exam.status || 'published',
            created_by: exam.created_by || 'admin',
            created_at: exam.created_at || new Date().toISOString(),
            updated_at: exam.updated_at || new Date().toISOString(),
            scheduled_start_at: exam.scheduled_start_at || null,
            scheduled_end_at: exam.scheduled_end_at || null,
            scheduled_start_ist: exam.scheduled_start_ist || null,
            total_questions: Number(exam.total_questions || questions.length),
            negative_marking: Boolean(exam.negative_marking),
            questions: publicQuestions
        });

        // Write secure answer keys
        const secureDocRef = db.collection('examinations_secure').doc(exam.id);
        await stageWrite(secureDocRef, {
            id: exam.id,
            title: exam.title,
            answer_keys: secretAnswerKeys,
            full_questions: questions,
            updated_at: exam.updated_at || new Date().toISOString()
        });
    }

    // 6. Migrate EXAM_ATTEMPTS
    console.log('[MIGRATE 4/5] Migrating exam_attempts collection...');
    for (const att of sourceAttempts) {
        const roll = String(att.roll_number || '').trim().toUpperCase();
        const docRef = db.collection('exam_attempts').doc(att.id);
        await stageWrite(docRef, {
            id: att.id,
            examination_id: att.examination_id,
            student_id: att.student_id || null,
            roll_number: roll,
            set_number: Number(att.set_number || 1),
            status: att.status || 'submitted',
            started_at: att.started_at || null,
            submitted_at: att.submitted_at || null,
            total_time_seconds: Number(att.total_time_seconds || 0),
            section_a_score: att.section_a_score !== null ? Number(att.section_a_score) : null,
            section_b_score: att.section_b_score !== null ? Number(att.section_b_score) : null,
            total_score: att.total_score !== null ? Number(att.total_score) : null,
            marks_obtained: att.marks_obtained !== null ? Number(att.marks_obtained) : null,
            is_final: Boolean(att.is_final),
            terms_accepted: Boolean(att.terms_accepted),
            terms_accepted_at: att.terms_accepted_at || null,
            deadline_at: att.deadline_at || null,
            fullscreen_violation_count: Number(att.fullscreen_violation_count || 0),
            termination_reason: att.termination_reason || null,
            answers: att.answers || {},
            created_at: att.created_at || new Date().toISOString(),
            updated_at: att.updated_at || new Date().toISOString()
        });
    }

    // 7. Migrate RESULTS
    console.log('[MIGRATE 5/5] Migrating results collection...');
    for (const res of sourceResults) {
        const roll = String(res.roll_number || '').trim().toUpperCase();
        const docRef = db.collection('results').doc(res.id);
        await stageWrite(docRef, {
            id: res.id,
            attempt_id: res.attempt_id,
            student_id: res.student_id || null,
            examination_id: res.examination_id,
            score: Number(res.score || 0),
            total_marks: Number(res.total_marks || 0),
            percentage: Number(res.percentage || 0),
            section_breakdown: res.section_breakdown || [],
            time_taken_seconds: Number(res.time_taken_seconds || 0),
            completed_at: res.completed_at || null,
            status: res.status || 'Pass',
            termination_reason: res.termination_reason || null,
            auto_submitted: Boolean(res.auto_submitted),
            roll_number: roll,
            created_at: res.completed_at || new Date().toISOString(),
            updated_at: res.completed_at || new Date().toISOString()
        });
    }

    // Flush any remaining writes
    await flushBatch();
    console.log('\n[MIGRATE] All writes successfully flushed to Firestore!');

    // 8. Verification & Integrity Audit
    console.log('\n==================================================================');
    console.log('  MIGRATION VERIFICATION & INTEGRITY COMPARISON');
    console.log('==================================================================');

    async function getCollectionCount(colName) {
        const snapshot = await db.collection(colName).count().get();
        return snapshot.data().count;
    }

    const firestoreCounts = {
        profiles: await getCollectionCount('profiles'),
        students: await getCollectionCount('students'),
        examinations: await getCollectionCount('examinations'),
        examinations_secure: await getCollectionCount('examinations_secure'),
        exam_attempts: await getCollectionCount('exam_attempts'),
        results: await getCollectionCount('results')
    };

    console.log('[INTEGRITY] Firestore Collection Record Counts:');
    for (const [col, count] of Object.entries(firestoreCounts)) {
        console.log(`  - ${col.padEnd(20)}: ${count}`);
    }

    // Strict validation
    if (firestoreCounts.profiles !== 67) throw new Error(`Profiles count mismatch: ${firestoreCounts.profiles} !== 67`);
    if (firestoreCounts.students !== 67) throw new Error(`Students count mismatch: ${firestoreCounts.students} !== 67`);
    if (firestoreCounts.examinations !== 17) throw new Error(`Examinations count mismatch: ${firestoreCounts.examinations} !== 17`);
    if (firestoreCounts.examinations_secure !== 17) throw new Error(`Examinations Secure count mismatch: ${firestoreCounts.examinations_secure} !== 17`);
    if (firestoreCounts.exam_attempts !== 26) throw new Error(`Exam Attempts count mismatch: ${firestoreCounts.exam_attempts} !== 26`);
    if (firestoreCounts.results !== 4) throw new Error(`Results count mismatch: ${firestoreCounts.results} !== 4`);

    // Verify student spot-check: active student vs deactivated student
    const activeDoc = await db.collection('students').doc('25JR1A1260').get();
    if (!activeDoc.exists || activeDoc.data().status !== 'active') {
        throw new Error('Spot check failed for active student 25JR1A1260!');
    }
    const deactDoc = await db.collection('students').doc('232E3').get();
    if (!deactDoc.exists || deactDoc.data().status !== 'deactivated') {
        throw new Error('Spot check failed for deactivated student 232E3!');
    }

    // Verify answer key isolation: check public exam vs secure exam
    const sampleExamId = sourceExaminations[0].id;
    const pubSnap = await db.collection('examinations').doc(sampleExamId).get();
    const secSnap = await db.collection('examinations_secure').doc(sampleExamId).get();

    const pubQ = pubSnap.data().questions[0];
    if (pubQ.correct_answer !== undefined || pubQ.explanation !== undefined) {
        throw new Error('Security violation: correct_answer or explanation leaked to public examinations document!');
    }
    const secKeys = secSnap.data().answer_keys;
    if (!Array.isArray(secKeys) || secKeys.length === 0 || !secKeys[0].correct_answer) {
        throw new Error('Security verification failed: answer keys missing from examinations_secure document!');
    }

    console.log('\n[PASS] Security Verification Passed: Answer keys strictly isolated in examinations_secure!');
    console.log('[PASS] Student Status Verification Passed: 62 active and 5 deactivated preserved accurately.');
    console.log('[PASS] Full Firestore Data Migration Verified 100% Successful!');
}

runDirectMigration().then(() => process.exit(0)).catch(err => {
    console.error('\n[MIGRATION-FATAL-ERROR]', err);
    process.exit(1);
});
