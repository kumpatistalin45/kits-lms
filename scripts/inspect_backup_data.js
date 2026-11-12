const fs = require('fs');
const path = require('path');

const backupPath = path.join(__dirname, '..', 'backups', 'supabase_backup_1794484230921.json');
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

console.log('=== BACKUP DATA AUDIT ===');
console.log('Timestamp:', backup.timestamp);
console.log('Tables present:', Object.keys(backup.tables));

const students = backup.tables.students || [];
const profiles = backup.tables.profiles || [];
const examinations = backup.tables.examinations || [];
const attempts = backup.tables.exam_attempts || [];
const results = backup.tables.results || [];

console.log('\n--- TABLE COUNTS ---');
console.log('students:', students.length);
console.log('profiles:', profiles.length);
console.log('examinations:', examinations.length);
console.log('exam_attempts:', attempts.length);
console.log('results:', results.length);

console.log('\n--- STUDENTS SAMPLE (FIRST 5) ---');
console.log(JSON.stringify(students.slice(0, 5), null, 2));

console.log('\n--- PROFILES SAMPLE (FIRST 5) ---');
console.log(JSON.stringify(profiles.slice(0, 5), null, 2));

console.log('\n--- STUDENT ROLL NUMBERS & BRANCHES ---');
const rollNumbers = students.map(s => s.roll_number);
console.log('Total roll numbers:', rollNumbers.length);
console.log('Unique roll numbers:', new Set(rollNumbers).size);

// Check roll number prefixes / distribution
const prefixCounts = {};
rollNumbers.forEach(r => {
    const prefix = r.slice(0, 7); // e.g. 24JR5A1
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
});
console.log('Roll prefix distribution:', prefixCounts);

// Compare students vs profiles
const profileRolls = new Set(profiles.map(p => p.roll_number));
const studentRolls = new Set(students.map(s => s.roll_number));

const inStudNotProf = [...studentRolls].filter(r => !profileRolls.has(r));
const inProfNotStud = [...profileRolls].filter(r => !studentRolls.has(r));
console.log('In students but not profiles:', inStudNotProf);
console.log('In profiles but not students:', inProfNotStud);

// Status breakdown
const statusCounts = {};
students.forEach(s => {
    statusCounts[s.status || 'active'] = (statusCounts[s.status || 'active'] || 0) + 1;
});
console.log('Student status breakdown:', statusCounts);

// Check Auth UIDs in students
const withAuthUid = students.filter(s => s.auth_uid);
console.log(`Students with auth_uid: ${withAuthUid.length} / ${students.length}`);
if (withAuthUid.length > 0) {
    console.log('Sample auth_uid:', withAuthUid.slice(0, 3).map(s => ({ roll: s.roll_number, auth_uid: s.auth_uid })));
}

// Check examinations
console.log('\n--- EXAMINATIONS AUDIT ---');
examinations.forEach((e, idx) => {
    console.log(`[Exam ${idx + 1}] ID: ${e.id}, Title: "${e.title || e.name}", Questions: ${e.total_questions || (e.questions ? e.questions.length : 0)}, Marks: ${e.total_marks}, Duration: ${e.duration_minutes}m, Status: ${e.status}`);
});

// Check attempts
console.log('\n--- EXAM ATTEMPTS AUDIT ---');
console.log(`Total attempts: ${attempts.length}`);
const attemptsByExam = {};
attempts.forEach(a => {
    attemptsByExam[a.examination_id || a.examId] = (attemptsByExam[a.examination_id || a.examId] || 0) + 1;
});
console.log('Attempts per exam:', attemptsByExam);

// Check results
console.log('\n--- RESULTS AUDIT ---');
console.log(`Total results: ${results.length}`);
console.log(JSON.stringify(results, null, 2));

