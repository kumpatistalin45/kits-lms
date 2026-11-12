const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function backup() {
    console.log('[BACKUP] Connecting to Supabase PostgreSQL...');
    const tables = ['students', 'profiles', 'examinations', 'exam_attempts', 'results'];
    const backupData = {
        timestamp: new Date().toISOString(),
        tables: {}
    };

    for (const table of tables) {
        try {
            const res = await pool.query(`SELECT * FROM public.${table};`);
            backupData.tables[table] = res.rows;
            console.log(`[BACKUP] Table '${table}': ${res.rows.length} rows backed up.`);
        } catch (err) {
            console.warn(`[BACKUP-WARN] Failed to backup table '${table}':`, err.message);
        }
    }

    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupPath = path.join(backupDir, `supabase_backup_${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`[BACKUP] Successfully saved complete database backup to ${backupPath}`);
}

backup().then(() => pool.end()).catch(err => {
    console.error('[BACKUP-ERROR]', err);
    pool.end();
    process.exit(1);
});

