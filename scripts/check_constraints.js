const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkConstraints() {
    try {
        const res = await pool.query(`
            SELECT conname, contype, pg_get_constraintdef(oid) as def
            FROM pg_constraint 
            WHERE conrelid = 'public.students'::regclass
        `);
        console.log('Constraints on public.students:');
        console.table(res.rows);

        const idxRes = await pool.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'students' AND schemaname = 'public'
        `);
        console.log('\nIndexes on public.students:');
        console.table(idxRes.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkConstraints();
