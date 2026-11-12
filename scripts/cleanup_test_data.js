const path = require('path');
const fs = require('fs');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runCleanup() {
    const client = await pool.connect();
    try {
        console.log('=== STARTING CONTROLLED DATABASE CLEANUP ===');
        await client.query('BEGIN');

        // 1. Identify real/genuine profiles to protect
        const genuineEmails = ['kumpatistalin45@gmail.com', '24jr5a1207@gmail.com', 'srividyakumpati@gmail.com', 'm@gmail.com'];
        const genuineFuids = [
            '7NqFfN7kYXPYXZ1Rk3F5ZSyjLho1',
            'mggaZufcZWeIpqniPjCpAlnoMtg2',
            'mP6cqXJTBXfhjI8HZhyyNk2GqEy2',
            'pRMLaySm5GWWKGm9cRvqZe91iOY2'
        ];
        const genuineRolls = ['232E3', '24JR5A1207', '23JR1A12B0', '33JR1A1267'];

        console.log('Protected genuine emails:', genuineEmails);
        console.log('Protected genuine roll numbers:', genuineRolls);

        // 2. Remove duplicate roll KUMPATISTALIN45 (keeping 232E3 for user)
        const dupRes = await client.query(`
            DELETE FROM public.students 
            WHERE roll_number = 'KUMPATISTALIN45'
            RETURNING id, roll_number;
        `);
        console.log(`Removed duplicate roll 'KUMPATISTALIN45': ${dupRes.rows.length} row(s)`);

        // 3. Remove all Antigravity test students from public.students
        const delStudRes = await client.query(`
            DELETE FROM public.students 
            WHERE roll_number NOT IN ($1, $2, $3, $4)
            RETURNING id, roll_number;
        `, genuineRolls);
        console.log(`Removed test students from public.students: ${delStudRes.rows.length} records`);

        // 4. Remove all test profiles from public.profiles
        const delProfRes = await client.query(`
            DELETE FROM public.profiles 
            WHERE firebase_uid NOT IN ($1, $2, $3, $4)
              AND email NOT IN ($5, $6, $7, $8)
            RETURNING id, firebase_uid, email;
        `, [...genuineFuids, ...genuineEmails]);
        console.log(`Removed test profiles from public.profiles: ${delProfRes.rows.length} records`);

        // 5. Clean up any test attempts and test results in DB
        const delAttRes = await client.query(`
            DELETE FROM public.exam_attempts 
            WHERE roll_number IS NOT NULL AND roll_number NOT IN ($1, $2, $3, $4)
            RETURNING id;
        `, genuineRolls);
        console.log(`Removed test attempts: ${delAttRes.rows.length} records`);

        const delResRes = await client.query(`
            DELETE FROM public.results 
            WHERE roll_number IS NOT NULL AND roll_number NOT IN ($1, $2, $3, $4)
            RETURNING id;
        `, genuineRolls);
        console.log(`Removed test results: ${delResRes.rows.length} records`);

        // 6. Ensure Normalized Unique Constraint & Index on students(roll_number)
        console.log('\nApplying UNIQUE constraint on UPPER(TRIM(roll_number))...');
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_students_unique_normalized_roll 
            ON public.students (UPPER(TRIM(roll_number)));
        `);
        console.log('Verified unique normalized index idx_students_unique_normalized_roll');

        await client.query('COMMIT');
        console.log('=== DATABASE TRANSACTION COMMITTED SUCCESSFULLY ===');

        // 7. Verify remaining students in DB
        const finalStud = await client.query(`
            SELECT s.id, s.roll_number, s.department, p.full_name, p.email, p.firebase_uid, s.created_at
            FROM public.students s
            LEFT JOIN public.profiles p ON s.profile_id = p.id
            ORDER BY s.roll_number;
        `);
        console.log(`\nFinal legitimate students in Supabase PostgreSQL (${finalStud.rows.length}):`);
        console.table(finalStud.rows);

        // 8. Clean up local .data files
        console.log('\nCleaning up local .data files...');
        const localStudentsPath = path.join(__dirname, '..', '.data', 'students.json');
        if (fs.existsSync(localStudentsPath)) {
            const preservedLocalStudents = finalStud.rows.map(r => ({
                id: r.id,
                profile_id: r.id,
                roll_number: r.roll_number,
                name: r.full_name || r.roll_number,
                email: r.email,
                department: r.department || 'Information Technology',
                academic_year: '3rd Year B.Tech',
                status: 'active',
                firebase_uid: r.firebase_uid,
                created_at: r.created_at
            }));
            fs.writeFileSync(localStudentsPath, JSON.stringify(preservedLocalStudents, null, 2));
            console.log(`Updated .data/students.json with ${preservedLocalStudents.length} legitimate students.`);
        }

        const localResultsPath = path.join(__dirname, '..', '.data', 'results.json');
        if (fs.existsSync(localResultsPath)) {
            const rawRes = JSON.parse(fs.readFileSync(localResultsPath, 'utf8'));
            const preservedRes = rawRes.filter(r => genuineRolls.includes(String(r.studentRoll || r.rollNumber || '').toUpperCase().trim()));
            fs.writeFileSync(localResultsPath, JSON.stringify(preservedRes, null, 2));
            console.log(`Updated .data/results.json: retained ${preservedRes.length} genuine results (purged ${rawRes.length - preservedRes.length} test results).`);
        }

        const localAttemptsPath = path.join(__dirname, '..', '.data', 'exam_attempts.json');
        if (fs.existsSync(localAttemptsPath)) {
            const rawAtt = JSON.parse(fs.readFileSync(localAttemptsPath, 'utf8'));
            const preservedAtt = rawAtt.filter(r => genuineRolls.includes(String(r.rollNumber || '').toUpperCase().trim()));
            fs.writeFileSync(localAttemptsPath, JSON.stringify(preservedAtt, null, 2));
            console.log(`Updated .data/exam_attempts.json: retained ${preservedAtt.length} genuine attempts (purged ${rawAtt.length - preservedAtt.length} test attempts).`);
        }

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error during cleanup - transaction rolled back:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

runCleanup();
