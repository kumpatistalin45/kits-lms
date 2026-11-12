const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { FirestoreAdapter } = require('../database-adapter');

async function testLiveRead() {
    console.log('[TEST] Initializing FirestoreAdapter...');
    const adapter = new FirestoreAdapter();
    await adapter.init();

    console.log('[TEST] Querying students from live Firestore...');
    const students = await adapter.getStudents();
    console.log(`[TEST] Retrieved ${students.length} students from live Firestore.`);

    console.log('[TEST] Querying examinations from live Firestore...');
    const exams = await adapter.getExaminations();
    console.log(`[TEST] Retrieved ${exams.length} examinations from live Firestore.`);

    console.log('[TEST] Testing getStudentByRoll("25JR1A1260")...');
    const s1 = await adapter.getStudentByRoll('25JR1A1260');
    console.log(`[TEST] Student 25JR1A1260: name="${s1?.name}", status="${s1?.status}", email="${s1?.email}"`);

    console.log('[TEST] Testing getStudentByRoll("232E3") (deactivated account)...');
    const sDeact = await adapter.getStudentByRoll('232E3');
    console.log(`[TEST] Student 232E3: name="${sDeact?.name}", status="${sDeact?.status}"`);

    console.log('[TEST] Testing getExaminationById...');
    const firstExam = await adapter.getExaminationById(exams[0].id);
    console.log(`[TEST] Exam: title="${firstExam?.title}", questionsCount=${firstExam?.questions?.length}`);

    console.log('[TEST] Testing getExaminationSecureKeys...');
    const keys = await adapter.getExaminationSecureKeys(exams[0].id);
    console.log(`[TEST] Secure Answer Keys: count=${keys?.length}, sampleKey=${keys?.[0]?.correct_answer}`);

    if (students.length === 67 && exams.length === 17 && s1 && sDeact?.status === 'deactivated' && keys?.length > 0) {
        console.log('\n[PASS] All live Firestore read operations verified 100% successfully!');
        process.exit(0);
    } else {
        console.error('\n[FAIL] Live Firestore read verification failed!');
        process.exit(1);
    }
}

testLiveRead().catch(err => {
    console.error('[ERROR]', err);
    process.exit(1);
});
