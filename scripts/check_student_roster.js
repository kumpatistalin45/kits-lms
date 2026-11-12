const fs = require('fs');
const path = require('path');

const backupPath = path.join(__dirname, '..', 'backups', 'supabase_backup_1794484230921.json');
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

const students = backup.tables.students || [];
const profiles = backup.tables.profiles || [];
const profileMap = new Map(profiles.map(p => [p.id, p]));

const fullStudentList = students.map(s => {
    const prof = profileMap.get(s.profile_id) || {};
    return {
        roll: s.roll_number,
        name: prof.full_name,
        email: prof.email,
        firebase_uid: prof.firebase_uid,
        department: s.department,
        academic_year: s.academic_year,
        created_at: s.created_at
    };
}).sort((a, b) => a.roll.localeCompare(b.roll));

console.log('Total students:', fullStudentList.length);
console.log('\n--- FULL ROLL LIST ---');
fullStudentList.forEach((s, idx) => {
    console.log(`${String(idx + 1).padStart(2, ' ')}. ${s.roll.padEnd(12, ' ')} | ${s.name.padEnd(30, ' ')} | ${s.email}`);
});

// Check gaps in 25JR1A1201 to 25JR1A12B9
const it25 = fullStudentList.filter(s => s.roll.startsWith('25JR1A12')).map(s => s.roll.slice(8));
console.log('\n25JR1A12 suffixes (' + it25.length + '):', it25.join(', '));

