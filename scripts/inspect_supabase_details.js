const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
env.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx !== -1) {
        const k = line.slice(0, idx).trim();
        let v = line.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[k] = v;
    }
});

async function run() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'students'`);
    console.log('Students columns:', cols.rows.map(c => c.column_name));

    const sRes = await pool.query(`
        SELECT s.*, p.full_name, p.email as profile_email 
        FROM students s 
        LEFT JOIN profiles p ON s.profile_id = p.id 
        ORDER BY s.roll_number
    `);
    console.log('Total students in Supabase:', sRes.rows.length);
    console.log('Sample first 5:');
    console.log(JSON.stringify(sRes.rows.slice(0, 5).map(r => ({ roll: r.roll_number, name: r.full_name, branch: r.branch, year: r.academic_year })), null, 2));
    console.log('Sample around index 58-63:');
    console.log(JSON.stringify(sRes.rows.slice(58, 63).map(r => ({ roll: r.roll_number, name: r.full_name, branch: r.branch, year: r.academic_year })), null, 2));
    console.log('Sample last 5:');
    console.log(JSON.stringify(sRes.rows.slice(-5).map(r => ({ roll: r.roll_number, name: r.full_name, branch: r.branch, year: r.academic_year })), null, 2));

    const eCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'examinations'`);
    console.log('Examinations columns:', eCols.rows.map(c => c.column_name));

    const eRes = await pool.query('SELECT * FROM examinations ORDER BY id');
    console.log('\nExaminations in Supabase: count =', eRes.rows.length);
    console.log(JSON.stringify(eRes.rows.map(e => ({ id: e.id, title: e.title, status: e.status, duration: e.duration_minutes, total_marks: e.total_marks, created_at: e.created_at })), null, 2));

    await pool.end();
}
run().catch(console.error);
