const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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
    const timestamp = Date.now();
    const backupDir = path.join(__dirname, '..', 'backups', `comprehensive_backup_${timestamp}`);
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`[BACKUP] Target directory: ${backupDir}`);

    // 1. Backup Supabase PostgreSQL
    console.log('\n--- Backing up Supabase PostgreSQL ---');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    
    // Get all tables in public schema
    const tablesRes = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log('Discovered Supabase tables:', tables);

    const supabaseBackup = {
        timestamp: new Date().toISOString(),
        tables: {},
        counts: {}
    };

    for (const t of tables) {
        const res = await pool.query(`SELECT * FROM public."${t}";`);
        supabaseBackup.tables[t] = res.rows;
        supabaseBackup.counts[t] = res.rows.length;
        console.log(`[SUPABASE] Backed up ${res.rows.length} records from table '${t}'.`);
    }
    await pool.end();

    const sbFile = path.join(backupDir, `supabase_full_dump_${timestamp}.json`);
    fs.writeFileSync(sbFile, JSON.stringify(supabaseBackup, null, 2), 'utf8');
    console.log(`[SUPABASE] Saved to ${sbFile}`);

    // 2. Backup Firestore
    console.log('\n--- Backing up Firebase Cloud Firestore ---');
    const keyPath = path.join(__dirname, '..', 'firebase-adminsdk-kits-lms-13053.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    const app = getApps().length > 0 ? getApps()[0] : initializeApp({
        credential: cert(serviceAccount),
        projectId: 'kits-lms-13053'
    });
    const db = getFirestore(app);

    const collections = ['students', 'profiles', 'examinations', 'examinations_secure', 'exam_attempts', 'results', 'revalidation_requests', 'revalidation_history'];
    const firestoreBackup = {
        timestamp: new Date().toISOString(),
        collections: {},
        counts: {}
    };

    for (const col of collections) {
        const snap = await db.collection(col).get();
        const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        firestoreBackup.collections[col] = docs;
        firestoreBackup.counts[col] = docs.length;
        console.log(`[FIRESTORE] Backed up ${docs.length} documents from collection '${col}'.`);
    }

    const fsFile = path.join(backupDir, `firestore_full_dump_${timestamp}.json`);
    fs.writeFileSync(fsFile, JSON.stringify(firestoreBackup, null, 2), 'utf8');
    console.log(`[FIRESTORE] Saved to ${fsFile}`);

    console.log('\n[SUCCESS] Comprehensive backup complete for both Supabase and Firestore.');
    console.log('Summary of counts:');
    console.log('Supabase:', supabaseBackup.counts);
    console.log('Firestore:', firestoreBackup.counts);
}

run().catch(err => {
    console.error('Backup error:', err);
    process.exit(1);
});

