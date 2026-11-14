const path = require('path');
const fs = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

async function run() {
    const keyPath = path.join(__dirname, '..', 'firebase-adminsdk-kits-lms-13053.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    const app = getApps().length > 0 ? getApps()[0] : initializeApp({
        credential: cert(serviceAccount),
        projectId: 'kits-lms-13053'
    });
    const db = getFirestore(app);

    const sSnap = await db.collection('students').get();
    console.log('Firestore students count:', sSnap.size);
    const rolls = sSnap.docs.map(d => d.id).sort();
    console.log('First 5 rolls:', rolls.slice(0, 5));
    console.log('Last 5 rolls:', rolls.slice(-5));

    const eSnap = await db.collection('examinations').get();
    console.log('Firestore examinations:', eSnap.docs.map(d => ({ id: d.id, title: d.data().title })));

    const aSnap = await db.collection('exam_attempts').get();
    console.log('Firestore attempts count:', aSnap.size);
    const examAttemptCounts = {};
    aSnap.docs.forEach(d => {
        const data = d.data();
        const eid = data.examId || data.exam_id || 'unknown';
        examAttemptCounts[eid] = (examAttemptCounts[eid] || 0) + 1;
    });
    console.log('Firestore attempts by exam:', examAttemptCounts);

    const rSnap = await db.collection('results').get();
    console.log('Firestore results count:', rSnap.size);
    const examResultCounts = {};
    rSnap.docs.forEach(d => {
        const data = d.data();
        const eid = data.examId || data.exam_id || 'unknown';
        examResultCounts[eid] = (examResultCounts[eid] || 0) + 1;
    });
    console.log('Firestore results by exam:', examResultCounts);
}

run().catch(console.error);

