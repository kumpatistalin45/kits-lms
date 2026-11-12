/**
 * KITS LMS — Deep Architecture & Database Audit Script
 * Phase 1: Read-Only Audit of Supabase PostgreSQL
 */

const path = require("path");
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runAudit() {
    console.log("==================================================================");
    console.log("  KITS LMS — SUPABASE POSTGRESQL ARCHITECTURAL AUDIT");
    console.log("==================================================================");

    const client = await pool.connect();
    const auditReport = {};

    try {
        // 1. List all public tables
        console.log("\n[1] Querying All Public Tables...");
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        auditReport.tables = tables;
        console.log("Public tables found:", tables);

        // 2. Exact record counts for every public table
        console.log("\n[2] Exact Record Counts for Public Tables:");
        auditReport.recordCounts = {};
        for (const tbl of tables) {
            try {
                const countRes = await client.query(`SELECT COUNT(*) AS total FROM public."${tbl}";`);
                const count = parseInt(countRes.rows[0].total, 10);
                auditReport.recordCounts[tbl] = count;
                console.log(`  - ${tbl}: ${count} rows`);
            } catch (err) {
                console.error(`  - ${tbl}: ERROR (${err.message})`);
                auditReport.recordCounts[tbl] = `Error: ${err.message}`;
            }
        }

        // 3. Check auth schema tables
        console.log("\n[3] Checking Supabase Auth Schema (auth.users)...");
        try {
            const authUsersCountRes = await client.query(`SELECT COUNT(*) AS total FROM auth.users;`);
            auditReport.authUsersCount = parseInt(authUsersCountRes.rows[0].total, 10);
            console.log(`  - auth.users: ${auditReport.authUsersCount} users`);

            const authUsersSample = await client.query(`
                SELECT id, email, created_at, last_sign_in_at, raw_user_meta_data 
                FROM auth.users LIMIT 10;
            `);
            auditReport.authUsersSample = authUsersSample.rows;
        } catch (e) {
            console.log("  auth.users query error:", e.message);
            auditReport.authUsersCount = `Error: ${e.message}`;
        }

        // 4. Check storage schema (storage.buckets, storage.objects)
        console.log("\n[4] Checking Supabase Storage...");
        try {
            const bucketsRes = await client.query(`SELECT id, name, public, created_at FROM storage.buckets;`);
            auditReport.storageBuckets = bucketsRes.rows;
            console.log("  Buckets:", bucketsRes.rows);

            const objectsRes = await client.query(`SELECT bucket_id, name, owner, created_at, metadata FROM storage.objects;`);
            auditReport.storageObjects = objectsRes.rows;
            console.log(`  Storage Objects (${objectsRes.rows.length}):`, objectsRes.rows);
        } catch (e) {
            console.log("  Storage query error:", e.message);
            auditReport.storageError = e.message;
        }

        // 5. Schema details (columns, types, nullability, defaults)
        console.log("\n[5] Auditing Columns & Types for All Public Tables...");
        auditReport.columns = {};
        for (const tbl of tables) {
            const colRes = await client.query(`
                SELECT column_name, data_type, udt_name, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position;
            `, [tbl]);
            auditReport.columns[tbl] = colRes.rows;
        }

        // 6. Constraints: Primary Keys, Foreign Keys, Unique
        console.log("\n[6] Auditing Primary Keys, Foreign Keys & Constraints...");
        const constraintsRes = await client.query(`
            SELECT 
                tc.table_name, 
                tc.constraint_name, 
                tc.constraint_type,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name,
                rc.update_rule,
                rc.delete_rule
            FROM information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            LEFT JOIN information_schema.referential_constraints AS rc
              ON tc.constraint_name = rc.constraint_name
            LEFT JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_name;
        `);
        auditReport.constraints = constraintsRes.rows;

        // 7. Indexes
        console.log("\n[7] Auditing Indexes...");
        const indexRes = await client.query(`
            SELECT tablename, indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname;
        `);
        auditReport.indexes = indexRes.rows;

        // 8. Triggers, Functions & Views
        console.log("\n[8] Auditing Triggers, Functions & Views...");
        const triggersRes = await client.query(`
            SELECT event_object_table, trigger_name, event_manipulation, action_statement, action_timing
            FROM information_schema.triggers
            WHERE trigger_schema = 'public'
            ORDER BY event_object_table, trigger_name;
        `);
        auditReport.triggers = triggersRes.rows;

        const viewsRes = await client.query(`
            SELECT table_name, view_definition
            FROM information_schema.views
            WHERE table_schema = 'public';
        `);
        auditReport.views = viewsRes.rows;

        const functionsRes = await client.query(`
            SELECT routine_name, routine_type, data_type
            FROM information_schema.routines
            WHERE routine_schema = 'public';
        `);
        auditReport.functions = functionsRes.rows;

        // 9. Row Level Security (RLS) Policies
        console.log("\n[9] Auditing Row Level Security (RLS) Policies...");
        const rlsRes = await client.query(`
            SELECT 
                schemaname, 
                tablename, 
                rowsecurity 
            FROM pg_tables 
            WHERE schemaname = 'public';
        `);
        auditReport.tableRlsStatus = rlsRes.rows;

        const policiesRes = await client.query(`
            SELECT 
                schemaname, 
                tablename, 
                policyname, 
                permissive, 
                roles, 
                cmd, 
                qual, 
                with_check
            FROM pg_policies
            WHERE schemaname = 'public';
        `);
        auditReport.policies = policiesRes.rows;
        console.log(`  RLS Policies found: ${policiesRes.rows.length}`);

        // 10. Deep Investigation: The 70 vs 67 Students Discrepancy
        console.log("\n[10] Investigating 70 vs 67 Students Discrepancy...");
        const studentsQuery = await client.query(`
            SELECT * FROM public.students ORDER BY roll_number;
        `);
        auditReport.allStudents = studentsQuery.rows;
        console.log(`  Total student rows in 'students': ${studentsQuery.rows.length}`);

        const profilesQuery = await client.query(`
            SELECT * FROM public.profiles ORDER BY roll_number;
        `);
        auditReport.allProfiles = profilesQuery.rows;
        console.log(`  Total profile rows in 'profiles': ${profilesQuery.rows.length}`);

        // Compare student roll numbers against profiles
        const studentRolls = new Set(studentsQuery.rows.map(s => (s.roll_number || "").toUpperCase().trim()));
        const profileRolls = new Set(profilesQuery.rows.map(p => (p.roll_number || "").toUpperCase().trim()));

        const inStudentsNotInProfiles = [...studentRolls].filter(r => !profileRolls.has(r));
        const inProfilesNotInStudents = [...profileRolls].filter(r => !studentRolls.has(r));

        auditReport.rollDiscrepancies = {
            inStudentsNotInProfiles,
            inProfilesNotInStudents
        };
        console.log("  In students but not profiles:", inStudentsNotInProfiles);
        console.log("  In profiles but not students:", inProfilesNotInStudents);

        // Check for duplicates in students or profiles
        const rollCountsStudents = {};
        studentsQuery.rows.forEach(s => {
            const r = (s.roll_number || "").toUpperCase().trim();
            rollCountsStudents[r] = (rollCountsStudents[r] || 0) + 1;
        });
        const duplicateRollsStudents = Object.entries(rollCountsStudents).filter(([_, c]) => c > 1);
        auditReport.duplicateRollsStudents = duplicateRollsStudents;
        console.log("  Duplicate student rolls:", duplicateRollsStudents);

        // 11. Incomplete / Orphaned Attempts and Results
        console.log("\n[11] Checking Exam Attempts & Results Integrity...");
        const attemptsQuery = await client.query(`
            SELECT a.id, a.examination_id, a.roll_number, a.status, a.started_at, a.deadline_at, a.submitted_at, a.set_number
            FROM public.exam_attempts a
            ORDER BY a.started_at DESC;
        `);
        auditReport.allAttempts = attemptsQuery.rows;
        console.log(`  Total attempt rows: ${attemptsQuery.rows.length}`);

        const resultsQuery = await client.query(`
            SELECT r.id, r.attempt_id, r.examination_id, r.roll_number, r.score, r.total_marks, r.percentage, r.status, r.completed_at
            FROM public.results r
            ORDER BY r.completed_at DESC;
        `);
        auditReport.allResults = resultsQuery.rows;
        console.log(`  Total result rows: ${resultsQuery.rows.length}`);

        // Check orphaned attempts (referencing non-existent examination_id)
        const examsQuery = await client.query(`SELECT id, title, total_questions, total_marks, duration_minutes, status, created_at FROM public.examinations;`);
        auditReport.allExams = examsQuery.rows;
        console.log(`  Total examination rows: ${examsQuery.rows.length}`);
        const examIds = new Set(examsQuery.rows.map(e => e.id));

        const orphanedAttempts = attemptsQuery.rows.filter(a => !examIds.has(a.examination_id));
        const orphanedResults = resultsQuery.rows.filter(r => !examIds.has(r.examination_id));
        auditReport.orphanedAttempts = orphanedAttempts;
        auditReport.orphanedResults = orphanedResults;
        console.log(`  Orphaned attempts (non-existent exam): ${orphanedAttempts.length}`);
        console.log(`  Orphaned results (non-existent exam): ${orphanedResults.length}`);

        // Check attempts by non-existent students
        const attemptsWithoutStudent = attemptsQuery.rows.filter(a => !studentRolls.has((a.roll_number || "").toUpperCase().trim()));
        auditReport.attemptsWithoutStudent = attemptsWithoutStudent;
        console.log(`  Attempts with unknown student roll: ${attemptsWithoutStudent.length}`);

        // Save detailed JSON report to scratch directory
        const outPath = path.join(__dirname, "../scratch_supabase_audit.json");
        fs.writeFileSync(outPath, JSON.stringify(auditReport, null, 2), "utf8");
        console.log(`\n✓ Full detailed audit data saved to ${outPath}`);

    } finally {
        client.release();
        await pool.end();
    }
}

runAudit().catch(err => {
    console.error("AUDIT FAILED:", err);
    process.exit(1);
});
