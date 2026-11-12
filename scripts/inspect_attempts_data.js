const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const res = await pool.query(`
        SELECT id, roll_number, examination_id, status, set_number, answers, started_at, submitted_at, marks_obtained
        FROM public.exam_attempts
        ORDER BY created_at DESC;
    `);
    console.log(`Found ${res.rows.length} attempts in Supabase:`);
    res.rows.forEach((r, idx) => {
        const ansKeys = r.answers ? Object.keys(r.answers) : [];
        console.log(`[${idx + 1}] Roll: ${r.roll_number}, Exam: ${r.examination_id}, Set: ${r.set_number}, Status: ${r.status}, AnswersCount: ${ansKeys.length}, SampleAns: ${JSON.stringify(r.answers).slice(0, 80)}`);
    });
}
run().then(() => pool.end()).catch(console.error);

