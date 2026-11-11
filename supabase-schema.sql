-- ============================================================================
-- KITS LMS Production Database Schema (PostgreSQL / Supabase)
-- Learning Management & Examination System
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. CORE USER PROFILES & ROLES
-- ============================================================================

-- Base profiles table mapped to Firebase Auth UID
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid TEXT UNIQUE NOT NULL,
    auth_uid TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'faculty', 'admin')),
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Students extension table
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    roll_number TEXT UNIQUE NOT NULL,
    department TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    enrolled_courses TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Faculty extension table
CREATE TABLE IF NOT EXISTS public.faculty (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    employee_id TEXT UNIQUE NOT NULL,
    department TEXT NOT NULL,
    designation TEXT DEFAULT 'Assistant Professor',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================================
-- 3. ACADEMIC COURSES & CURRICULUM
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.courses (
    id TEXT PRIMARY KEY, -- e.g. 'entrepreneurship', 'python', 'dbms'
    title TEXT NOT NULL,
    code TEXT,
    description TEXT,
    department TEXT NOT NULL,
    instructor_name TEXT NOT NULL,
    instructor_id UUID REFERENCES public.faculty(id) ON DELETE SET NULL,
    level TEXT DEFAULT 'Intermediate' CHECK (level IN ('Beginner', 'Intermediate', 'Advanced')),
    duration TEXT DEFAULT '40 Hours',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================================
-- 4. EXAMINATIONS & RANDOMIZED SETS
-- Structure: 50 Marks total, 90 Minutes Duration
-- Section A: 20 MCQs (20m) + 10 MSQs (10m) = 30 Marks
-- Section B: 4 Coding/Debugging Problems (5m each) = 20 Marks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.examinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id TEXT NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    total_marks NUMERIC(5,2) DEFAULT 50.00 NOT NULL,
    duration_minutes INTEGER DEFAULT 90 NOT NULL,
    mcq_count INTEGER DEFAULT 20 NOT NULL,
    msq_count INTEGER DEFAULT 10 NOT NULL,
    coding_count INTEGER DEFAULT 4 NOT NULL,
    set_count INTEGER DEFAULT 10 NOT NULL,
    eligibility_dept TEXT DEFAULT 'All',
    instructions TEXT,
    section_a_pdf_url TEXT,
    section_b_pdf_url TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Section A Question Bank: MCQ and MSQ
CREATE TABLE IF NOT EXISTS public.question_banks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    examination_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('mcq', 'msq')),
    statement TEXT NOT NULL,
    options JSONB NOT NULL, -- Array: ["Option A", "Option B", "Option C", "Option D"]
    correct_answers JSONB NOT NULL, -- Array: ["A"] for MCQ, ["A","B"] for MSQ
    marks NUMERIC(4,2) DEFAULT 1.00 NOT NULL,
    explanation TEXT,
    source TEXT DEFAULT 'pdf_extracted',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Section B Coding Bank: 4 Standard Questions (HTML Coding, HTML+CSS, HTML Debug, CSS Debug)
CREATE TABLE IF NOT EXISTS public.coding_banks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    examination_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
    problem_index INTEGER NOT NULL CHECK (problem_index BETWEEN 1 AND 4),
    type TEXT NOT NULL CHECK (type IN ('html_coding', 'html_css_coding', 'html_debugging', 'css_debugging')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    starter_html TEXT DEFAULT '',
    starter_css TEXT DEFAULT '',
    solution_html TEXT DEFAULT '',
    solution_css TEXT DEFAULT '',
    test_cases JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of test case specifications
    marks NUMERIC(4,2) DEFAULT 5.00 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Randomized Set Assignments (Set 1 to Set 10 per Student)
CREATE TABLE IF NOT EXISTS public.exam_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    examination_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 10),
    question_order JSONB NOT NULL, -- Permutation of Section A question IDs & option mappings
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(examination_id, student_id)
);

-- ============================================================================
-- 5. EXAM ATTEMPTS, SUBMISSIONS & RESULTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.exam_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    examination_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    set_number INTEGER NOT NULL,
    status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'evaluated', 'abandoned')),
    started_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    submitted_at TIMESTAMPTZ,
    total_time_seconds INTEGER DEFAULT 0,
    section_a_score NUMERIC(5,2) DEFAULT 0.00,
    section_b_score NUMERIC(5,2) DEFAULT 0.00,
    total_score NUMERIC(5,2) DEFAULT 0.00,
    is_final BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Student Answers (Autosaved during exam)
CREATE TABLE IF NOT EXISTS public.student_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL,
    section TEXT NOT NULL CHECK (section IN ('A', 'B')),
    selected_options JSONB DEFAULT '[]'::jsonb, -- Array of selected option letters/indices
    submitted_code JSONB DEFAULT '{}'::jsonb, -- {"html": "...", "css": "..."}
    test_case_results JSONB DEFAULT '[]'::jsonb,
    is_correct BOOLEAN DEFAULT FALSE,
    marks_awarded NUMERIC(4,2) DEFAULT 0.00,
    saved_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(attempt_id, question_id)
);

-- Official Published Examination Results
CREATE TABLE IF NOT EXISTS public.results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID UNIQUE NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    examination_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
    score NUMERIC(5,2) NOT NULL,
    total_marks NUMERIC(5,2) DEFAULT 50.00 NOT NULL,
    percentage NUMERIC(5,2) NOT NULL,
    section_breakdown JSONB NOT NULL, -- {"sectionA_mcq": 18, "sectionA_msq": 8, "sectionB_coding": 18}
    time_taken_seconds INTEGER NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ============================================================================
-- 6. INDEXES FOR HIGH-PERFORMANCE QUERYING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_firebase_uid ON public.profiles(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_profiles_auth_uid ON public.profiles(auth_uid);
CREATE INDEX IF NOT EXISTS idx_students_profile_id ON public.students(profile_id);
CREATE INDEX IF NOT EXISTS idx_students_roll ON public.students(roll_number);
CREATE INDEX IF NOT EXISTS idx_examinations_course ON public.examinations(course_id);
CREATE INDEX IF NOT EXISTS idx_examinations_status ON public.examinations(status);
CREATE INDEX IF NOT EXISTS idx_question_banks_exam ON public.question_banks(examination_id);
CREATE INDEX IF NOT EXISTS idx_coding_banks_exam ON public.coding_banks(examination_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON public.exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam ON public.exam_attempts(examination_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_attempt ON public.student_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_results_student ON public.results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_exam ON public.results(examination_id);

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.examinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;

-- Helper security function: get current profile role
CREATE OR REPLACE FUNCTION public.get_current_role()
RETURNS TEXT AS $$
    SELECT role FROM public.profiles WHERE auth_uid = auth.uid()::TEXT;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by owner or service" ON public.profiles;
DROP POLICY IF EXISTS "Allow profile provisioning" ON public.profiles;

CREATE POLICY "Profiles viewable by owner or service"
ON public.profiles FOR SELECT
USING (true);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (true);

CREATE POLICY "Allow profile provisioning"
ON public.profiles FOR INSERT
WITH CHECK (true);

-- Students Policies
DROP POLICY IF EXISTS "Students can view own student record" ON public.students;
DROP POLICY IF EXISTS "Students can update own enrollment" ON public.students;
DROP POLICY IF EXISTS "Allow student registration" ON public.students;
DROP POLICY IF EXISTS "Students viewable by anyone or service" ON public.students;

CREATE POLICY "Students viewable by anyone or service"
ON public.students FOR SELECT
USING (true);

CREATE POLICY "Students can update own enrollment"
ON public.students FOR UPDATE
USING (true);

CREATE POLICY "Allow student registration"
ON public.students FOR INSERT
WITH CHECK (true);

-- Courses Policies
DROP POLICY IF EXISTS "Anyone authenticated can view active courses" ON public.courses;
DROP POLICY IF EXISTS "Active courses viewable by all" ON public.courses;
CREATE POLICY "Active courses viewable by all"
ON public.courses FOR SELECT
USING (is_active = TRUE);

CREATE POLICY "Faculty and admin can manage courses"
ON public.courses FOR ALL TO authenticated
USING (public.get_current_role() IN ('faculty', 'admin'));

-- Examinations Policies
DROP POLICY IF EXISTS "Students can view published exams" ON public.examinations;
DROP POLICY IF EXISTS "Published exams viewable by all" ON public.examinations;
CREATE POLICY "Published exams viewable by all"
ON public.examinations FOR SELECT
USING (status = 'published');
ON public.examinations FOR SELECT TO authenticated
USING (status = 'published' OR public.get_current_role() IN ('faculty', 'admin'));

CREATE POLICY "Faculty and admin can manage exams"
ON public.examinations FOR ALL TO authenticated
USING (public.get_current_role() IN ('faculty', 'admin'));

-- Question Banks & Coding Banks Policies
CREATE POLICY "Faculty and admin manage question banks"
ON public.question_banks FOR ALL TO authenticated
USING (public.get_current_role() IN ('faculty', 'admin'));

CREATE POLICY "Students can view questions of assigned exam"
ON public.question_banks FOR SELECT TO authenticated
USING (examination_id IN (
    SELECT id FROM public.examinations WHERE status = 'published'
));

CREATE POLICY "Faculty and admin manage coding banks"
ON public.coding_banks FOR ALL TO authenticated
USING (public.get_current_role() IN ('faculty', 'admin'));

CREATE POLICY "Students can view coding questions of assigned exam"
ON public.coding_banks FOR SELECT TO authenticated
USING (examination_id IN (
    SELECT id FROM public.examinations WHERE status = 'published'
));

-- Exam Attempts Policies
CREATE POLICY "Students can view and manage their own exam attempts"
ON public.exam_attempts FOR ALL TO authenticated
USING (
    student_id IN (
        SELECT s.id FROM public.students s
        JOIN public.profiles p ON s.profile_id = p.id
        WHERE p.auth_uid = auth.uid()::TEXT
    )
    OR public.get_current_role() IN ('faculty', 'admin')
);

-- Student Answers Policies
CREATE POLICY "Students can save their own answers"
ON public.student_answers FOR ALL TO authenticated
USING (
    attempt_id IN (
        SELECT a.id FROM public.exam_attempts a
        JOIN public.students s ON a.student_id = s.id
        JOIN public.profiles p ON s.profile_id = p.id
        WHERE p.auth_uid = auth.uid()::TEXT
    )
    OR public.get_current_role() IN ('faculty', 'admin')
);

-- Results Policies
CREATE POLICY "Students view own results, Faculty/Admin view all"
ON public.results FOR SELECT TO authenticated
USING (
    student_id IN (
        SELECT s.id FROM public.students s
        JOIN public.profiles p ON s.profile_id = p.id
        WHERE p.auth_uid = auth.uid()::TEXT
    )
    OR public.get_current_role() IN ('faculty', 'admin')
);

CREATE POLICY "Faculty/Admin can insert and manage results"
ON public.results FOR ALL TO authenticated
USING (public.get_current_role() IN ('faculty', 'admin'));

-- ============================================================================
-- 8. STORAGE BUCKET CONFIGURATION (Supabase Storage)
-- Bucket: 'exam-papers' (Private bucket for PDF Question Papers)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('exam-papers', 'exam-papers', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Storage Policy: Faculty & Admin can upload exam PDFs
CREATE POLICY "Faculty and admin can upload exam papers"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'exam-papers'
    AND public.get_current_role() IN ('faculty', 'admin')
);

-- Storage Policy: Faculty & Admin can view all exam PDFs
CREATE POLICY "Faculty and admin can view exam papers"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'exam-papers'
    AND public.get_current_role() IN ('faculty', 'admin')
);

-- Storage Policy: Faculty & Admin can update/delete exam PDFs
CREATE POLICY "Faculty and admin can delete exam papers"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'exam-papers'
    AND public.get_current_role() IN ('faculty', 'admin')
);

-- ============================================================================
-- 9. AUTOMATIC TIMESTAMP TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_examinations_updated_at ON public.examinations;
CREATE TRIGGER set_examinations_updated_at
    BEFORE UPDATE ON public.examinations
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_attempts_updated_at ON public.exam_attempts;
CREATE TRIGGER set_attempts_updated_at
    BEFORE UPDATE ON public.exam_attempts
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

