if (process.loadEnvFile) process.loadEnvFile('.env');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const sql = `
-- 1. Drop dependent policies
DROP POLICY IF EXISTS "Students can view questions of assigned exam" ON public.question_banks;
DROP POLICY IF EXISTS "Students can view coding questions of assigned exam" ON public.coding_banks;
DROP POLICY IF EXISTS "Published exams viewable by all" ON public.examinations;
DROP POLICY IF EXISTS "Faculty and admin can manage exams" ON public.examinations;

-- 2. Drop legacy course foreign key constraint
ALTER TABLE public.examinations DROP CONSTRAINT IF EXISTS examinations_course_id_fkey;
ALTER TABLE public.examinations ALTER COLUMN course_id DROP NOT NULL;

-- 3. Drop table foreign keys to examinations(id)
ALTER TABLE public.question_banks DROP CONSTRAINT IF EXISTS question_banks_examination_id_fkey;
ALTER TABLE public.coding_banks DROP CONSTRAINT IF EXISTS coding_banks_examination_id_fkey;
ALTER TABLE public.exam_assignments DROP CONSTRAINT IF EXISTS exam_assignments_examination_id_fkey;
ALTER TABLE public.exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_examination_id_fkey;
ALTER TABLE public.results DROP CONSTRAINT IF EXISTS results_examination_id_fkey;

-- 4. Alter id types to TEXT
ALTER TABLE public.examinations ALTER COLUMN id TYPE TEXT;
ALTER TABLE public.examinations ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.question_banks ALTER COLUMN examination_id TYPE TEXT;
ALTER TABLE public.coding_banks ALTER COLUMN examination_id TYPE TEXT;
ALTER TABLE public.exam_assignments ALTER COLUMN examination_id TYPE TEXT;
ALTER TABLE public.exam_attempts ALTER COLUMN examination_id TYPE TEXT;
ALTER TABLE public.results ALTER COLUMN examination_id TYPE TEXT;

-- 5. Re-add foreign key constraints
ALTER TABLE public.question_banks ADD CONSTRAINT question_banks_examination_id_fkey FOREIGN KEY (examination_id) REFERENCES public.examinations(id) ON DELETE CASCADE;
ALTER TABLE public.coding_banks ADD CONSTRAINT coding_banks_examination_id_fkey FOREIGN KEY (examination_id) REFERENCES public.examinations(id) ON DELETE CASCADE;
ALTER TABLE public.exam_assignments ADD CONSTRAINT exam_assignments_examination_id_fkey FOREIGN KEY (examination_id) REFERENCES public.examinations(id) ON DELETE CASCADE;
ALTER TABLE public.exam_attempts ADD CONSTRAINT exam_attempts_examination_id_fkey FOREIGN KEY (examination_id) REFERENCES public.examinations(id) ON DELETE CASCADE;
ALTER TABLE public.results ADD CONSTRAINT results_examination_id_fkey FOREIGN KEY (examination_id) REFERENCES public.examinations(id) ON DELETE CASCADE;

-- 6. Add modern 50-MCQ examination columns
ALTER TABLE public.examinations ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;
ALTER TABLE public.examinations ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ;
ALTER TABLE public.examinations ADD COLUMN IF NOT EXISTS scheduled_start_ist TEXT;
ALTER TABLE public.examinations ADD COLUMN IF NOT EXISTS total_questions INTEGER DEFAULT 50;
ALTER TABLE public.examinations ADD COLUMN IF NOT EXISTS negative_marking BOOLEAN DEFAULT FALSE;
ALTER TABLE public.examinations ADD COLUMN IF NOT EXISTS questions JSONB;

-- 7. Recreate RLS policies
CREATE POLICY "Published exams viewable by all"
ON public.examinations FOR SELECT
USING (status = 'published');

CREATE POLICY "Faculty and admin can manage exams"
ON public.examinations FOR ALL TO authenticated
USING (public.get_current_role() IN ('faculty', 'admin'));

CREATE POLICY "Students can view questions of assigned exam"
ON public.question_banks FOR SELECT TO authenticated
USING (examination_id IN (
    SELECT id FROM public.examinations WHERE status = 'published'
));

CREATE POLICY "Students can view coding questions of assigned exam"
ON public.coding_banks FOR SELECT TO authenticated
USING (examination_id IN (
    SELECT id FROM public.examinations WHERE status = 'published'
));
`;

async function run() {
    try {
        await pool.query(sql);
        console.log("Migration executed successfully!");
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'examinations';");
        console.log("New column types:", res.rows.map(r => `${r.column_name}: ${r.data_type}`));
    } catch (e) {
        console.error("Migration Error:", e);
    } finally {
        await pool.end();
    }
}

run();
