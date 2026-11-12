const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectSchema() {
    try {
        console.log('=== TABLE SCHEMAS ===');
        const colsRes = await pool.query(`
            SELECT table_name, column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `);
        
        const byTable = {};
        colsRes.rows.forEach(r => {
            if (!byTable[r.table_name]) byTable[r.table_name] = [];
            byTable[r.table_name].push(`${r.column_name} (${r.data_type})`);
        });
        for (const [t, cols] of Object.entries(byTable)) {
            console.log(`\nTable: ${t}`);
            console.log('  ' + cols.join(', '));
        }

        console.log('\n=== ALL PROFILES & STUDENTS PROVENANCE AUDIT ===');
        const studentsAudit = await pool.query(`
            SELECT s.id as student_id, s.roll_number, s.department, s.created_at as student_created,
                   p.id as profile_id, p.firebase_uid, p.email, p.full_name, p.role, p.created_at as profile_created
            FROM students s
            FULL OUTER JOIN profiles p ON s.profile_id = p.id
            ORDER BY s.roll_number NULLS LAST
        `);
        console.log(`Total Joined Records: ${studentsAudit.rows.length}`);

        // Classify records
        const testKeywords = ['load candidate', 'test student', 'dummy', 'candidate for deletion', 'live verification student', '22load', '22live', '22del', '22u120', 'student999', 'uid_'];
        const testRecords = [];
        const genuineRecords = [];

        studentsAudit.rows.forEach(r => {
            const name = (r.full_name || '').toLowerCase();
            const email = (r.email || '').toLowerCase();
            const roll = (r.roll_number || '').toLowerCase();
            const fuid = (r.firebase_uid || '').toLowerCase();

            const isTest = testKeywords.some(kw => 
                name.includes(kw) || email.includes(kw) || roll.includes(kw) || fuid.startsWith('uid_17') || fuid.includes('dummy') || fuid.startsWith('admin_created_')
            );

            if (isTest) {
                testRecords.push(r);
            } else {
                genuineRecords.push(r);
            }
        });

        console.log(`\nIdentified Test/Demo Records: ${testRecords.length}`);
        console.log(`Identified Legitimate/Real Records: ${genuineRecords.length}`);

        console.log('\n--- SAMPLE TEST RECORDS (first 10) ---');
        console.table(testRecords.slice(0, 10).map(r => ({
            roll: r.roll_number,
            name: r.full_name,
            email: r.email,
            fuid: r.firebase_uid,
            created: r.student_created
        })));

        console.log('\n--- ALL GENUINE / NON-TEST RECORDS ---');
        console.table(genuineRecords.map(r => ({
            roll: r.roll_number,
            name: r.full_name,
            email: r.email,
            fuid: r.firebase_uid,
            role: r.role,
            created: r.student_created
        })));

    } catch (e) {
        console.error('Error during inspection:', e);
    } finally {
        await pool.end();
    }
}

inspectSchema();
