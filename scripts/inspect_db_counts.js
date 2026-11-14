const fs = require('fs');
const path = require('path');

// Load .env
if (fs.existsSync('.env')) {
    const env = fs.readFileSync('.env', 'utf8');
    env.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const idx = line.indexOf('=');
        if (idx !== -1) {
            const k = line.slice(0, idx).trim();
            let v = line.slice(idx + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1);
            }
            process.env[k] = v;
        }
    });
}

const { getDatabaseAdapter } = require('../database-adapter');
const { Pool } = require('pg');

async function inspect() {
    console.log('=== Inspecting Firebase Firestore via Adapter ===');
    process.env.DB_ENGINE = 'firestore';
    const adapter = getDatabaseAdapter('firestore');
    await adapter.init();
    const hc = await adapter.healthCheck();
    console.log('Healthcheck:', hc);

    const students = await adapter.getStudents();
    const exams = await adapter.getExaminations();
    
    console.log('Firestore counts via Adapter:');
    console.log('- students:', students.length);
    console.log('- examinations:', exams.length);

    if (adapter.db) {
        const pSnap = await adapter.db.collection('profiles').get();
        const aSnap = await adapter.db.collection('exam_attempts').get();
        const rSnap = await adapter.db.collection('results').get();
        const secSnap = await adapter.db.collection('examinations_secure').get();
        const revSnap = await adapter.db.collection('revalidation_requests').get();
        console.log('- profiles:', pSnap.size);
        console.log('- exam_attempts:', aSnap.size);
        console.log('- results:', rSnap.size);
        console.log('- examinations_secure:', secSnap.size);
        console.log('- revalidation_requests:', revSnap.size);
    }

    console.log('\n=== Inspecting Supabase PostgreSQL ===');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        const client = await pool.connect();
        const sRes = await client.query('SELECT count(*) FROM students');
        const pRes = await client.query('SELECT count(*) FROM profiles');
        const eRes = await client.query('SELECT count(*) FROM examinations');
        const aRes = await client.query('SELECT count(*) FROM exam_attempts');
        const rRes = await client.query('SELECT count(*) FROM results');
        console.log('Supabase counts:');
        console.log('- students:', sRes.rows[0].count);
        console.log('- profiles:', pRes.rows[0].count);
        console.log('- examinations:', eRes.rows[0].count);
        console.log('- exam_attempts:', aRes.rows[0].count);
        console.log('- results:', rRes.rows[0].count);
        client.release();
    } catch(err) {
        console.log('Supabase query error:', err.message);
    } finally {
        await pool.end();
    }
}

inspect().catch(console.error);
