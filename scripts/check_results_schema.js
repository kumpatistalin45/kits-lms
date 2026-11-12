const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    const cols = await pool.query(`
        SELECT column_name, is_nullable, column_default, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'results';
    `);
    console.log('Results columns:');
    console.table(cols.rows);

    const fks = await pool.query(`
        SELECT conname, pg_get_constraintdef(oid) 
        FROM pg_constraint 
        WHERE conrelid = 'public.results'::regclass;
    `);
    console.log('Results constraints:');
    console.table(fks.rows);
}
run().then(() => pool.end()).catch(console.error);

