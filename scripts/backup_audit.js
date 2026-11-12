const path = require('path');
const fs = require('fs');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function backupAndAudit() {
    try {
        console.log('=== BACKING UP ENTIRE DATABASE TO LOCAL JSON FILE ===');
        const backup = {
            timestamp: new Date().toISOString(),
            tables: {}
        };

        const tableNames = [
            'profiles', 'students', 'examinations', 'exam_attempts', 
            'results', 'student_answers', 'exam_assignments', 'courses'
        ];

        for (const t of tableNames) {
            const res = await pool.query(`SELECT * FROM ${t}`);
            backup.tables[t] = res.rows;
            console.log(`Table ${t}: ${res.rows.length} rows backed up`);
        }

        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const backupFile = path.join(backupDir, `db_backup_${Date.now()}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
        console.log(`\nDATABASE FULL BACKUP SAVED TO: ${backupFile}`);

        // Check attempts and results by roll number
        console.log('\n=== RESULTS IN DB ===');
        const results = await pool.query("SELECT id, roll_number, examination_id, score, total_marks, created_at FROM results");
        console.table(results.rows);

        console.log('\n=== ATTEMPTS IN DB ===');
        const attempts = await pool.query("SELECT id, roll_number, examination_id, status, marks_obtained, created_at FROM exam_attempts");
        console.table(attempts.rows);

    } catch (e) {
        console.error('Error during backup & audit:', e);
    } finally {
        await pool.end();
    }
}

backupAndAudit();
