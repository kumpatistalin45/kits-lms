const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkProfileConstraints() {
    try {
        const res = await pool.query(`
            SELECT conname, contype, pg_get_constraintdef(oid) as def
            FROM pg_constraint 
            WHERE conrelid = 'public.profiles'::regclass
        `);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkProfileConstraints();
