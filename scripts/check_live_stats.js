const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    const resCount = await pool.query('SELECT count(*) FROM public.results');
    const attCount = await pool.query('SELECT count(*) FROM public.exam_attempts');
    const studCount = await pool.query('SELECT count(*) FROM public.students');
    console.log('Results in Supabase:', resCount.rows[0].count);
    console.log('Attempts in Supabase:', attCount.rows[0].count);
    console.log('Students in Supabase:', studCount.rows[0].count);
    
    const sampleResults = await pool.query('SELECT id, roll_number, examination_id, score, status, completed_at FROM public.results ORDER BY completed_at DESC NULLS LAST LIMIT 15');
    console.log('Sample Results:');
    console.table(sampleResults.rows);

    const sampleAttempts = await pool.query('SELECT id, roll_number, examination_id, status, started_at, submitted_at FROM public.exam_attempts ORDER BY created_at DESC NULLS LAST LIMIT 15');
    console.log('Sample Attempts:');
    console.table(sampleAttempts.rows);
}

check().then(() => pool.end()).catch(console.error);
