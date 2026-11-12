const path = require("path");
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function getDetailedSchema() {
    const client = await pool.connect();
    try {
        const tables = [
            'students', 'profiles', 'examinations', 'exam_attempts', 
            'results', 'student_answers', 'exam_assignments', 
            'courses', 'faculty', 'question_banks', 'coding_banks'
        ];

        const schema = {};
        for (const tbl of tables) {
            const cols = await client.query(`
                SELECT column_name, data_type, udt_name, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position;
            `, [tbl]);
            schema[tbl] = cols.rows;
        }

        // Constraints
        const cons = await client.query(`
            SELECT 
                tc.table_name, 
                tc.constraint_name, 
                tc.constraint_type,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            LEFT JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_name;
        `);

        // RLS
        const rls = await client.query(`
            SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
            FROM pg_policies WHERE schemaname = 'public';
        `);

        // Triggers
        const trigs = await client.query(`
            SELECT event_object_table, trigger_name, event_manipulation, action_statement, action_timing
            FROM information_schema.triggers WHERE trigger_schema = 'public';
        `);

        fs.writeFileSync(path.join(__dirname, '..', 'supabase_schema_dump.json'), JSON.stringify({
            schema,
            constraints: cons.rows,
            policies: rls.rows,
            triggers: trigs.rows
        }, null, 2));

        console.log("✓ Successfully dumped detailed schema, constraints, policies, and triggers to supabase_schema_dump.json");
    } finally {
        client.release();
        await pool.end();
    }
}

getDetailedSchema().catch(e => {
    console.error("Schema query failed:", e);
    process.exit(1);
});

