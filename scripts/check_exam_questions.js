const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const res = await pool.query("SELECT id, title, jsonb_array_length(questions) as qcount FROM public.examinations WHERE id = 'exam_1794453371172'");
    console.table(res.rows);
    const qSample = await pool.query("SELECT questions->0 as first_q, questions->1 as second_q FROM public.examinations WHERE id = 'exam_1794453371172'");
    console.log('Sample Q0:', JSON.stringify(qSample.rows[0].first_q, null, 2));
    console.log('Sample Q1:', JSON.stringify(qSample.rows[0].second_q, null, 2));
}
run().then(() => pool.end()).catch(console.error);

