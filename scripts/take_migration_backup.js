const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runBackup() {
    console.log('==================================================================');
    console.log('  KITS LMS — MANDATORY PRE-MIGRATION BACKUP & VERIFICATION');
    console.log('==================================================================');

    const expectedCounts = {
        students: 67,
        profiles: 67,
        examinations: 17,
        exam_attempts: 26,
        results: 4
    };

    const tables = ['students', 'profiles', 'examinations', 'exam_attempts', 'results'];
    const backupData = {
        timestamp: new Date().toISOString(),
        environment: 'production',
        source: 'Supabase PostgreSQL (aws-0-ap-northeast-1.pooler.supabase.com)',
        counts: {},
        tables: {}
    };

    for (const table of tables) {
        console.log(`[BACKUP] Fetching table 'public.${table}'...`);
        const res = await pool.query(`SELECT * FROM public.${table};`);
        backupData.tables[table] = res.rows;
        backupData.counts[table] = res.rows.length;
        console.log(`[BACKUP] Retrieved ${res.rows.length} records from 'public.${table}'.`);
    }

    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const filename = `supabase_migration_pre_cutover_${Date.now()}.json`;
    const backupPath = path.join(backupDir, filename);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`[BACKUP] Written to disk: ${backupPath}`);

    // Verification step
    console.log('\n[VERIFY] Verifying saved backup file readability and counts...');
    const raw = fs.readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(raw);

    let verifyPassed = true;
    for (const [table, expected] of Object.entries(expectedCounts)) {
        const actual = parsed.tables[table]?.length || 0;
        if (actual !== expected) {
            console.error(`[VERIFY-FAIL] Table '${table}': expected ${expected}, found ${actual} in backup file!`);
            verifyPassed = false;
        } else {
            console.log(`  [VERIFY-PASS] Table '${table}': exact match (${actual} / ${expected} records).`);
        }
    }

    if (!verifyPassed) {
        console.error('\n[FATAL] Backup verification failed! Migration stopped.');
        process.exit(1);
    }

    console.log('\n[SUCCESS] Mandatory pre-migration backup verified successfully.');
    console.log(`Backup File: ${backupPath}`);
}

runBackup().then(() => pool.end()).catch(err => {
    console.error('[BACKUP-ERROR]', err);
    pool.end();
    process.exit(1);
});

