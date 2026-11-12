const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkAllProfiles() {
    try {
        const res = await pool.query("SELECT id, firebase_uid, email, full_name, role, created_at FROM profiles ORDER BY created_at ASC");
        console.log(`Total profiles in DB: ${res.rows.length}`);
        
        const nonStudents = res.rows.filter(r => r.role !== 'student');
        console.log(`Non-student profiles: ${nonStudents.length}`);
        console.table(nonStudents);

        // Group by email
        const emailMap = {};
        res.rows.forEach(r => {
            const em = (r.email || '').toLowerCase().trim();
            if (!emailMap[em]) emailMap[em] = [];
            emailMap[em].push(r);
        });

        console.log('\n--- Profiles with real emails (not kits.edu dummy) ---');
        for (const [em, list] of Object.entries(emailMap)) {
            if (!em.endsWith('@kits.edu')) {
                console.log(em, list.map(p => ({ id: p.id, fuid: p.firebase_uid, name: p.full_name, role: p.role, created_at: p.created_at })));
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkAllProfiles();
