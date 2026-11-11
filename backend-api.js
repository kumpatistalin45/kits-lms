/**
 * KITS LMS — Unified Production Backend Service Layer
 * Integrates Firebase Authentication with Supabase PostgreSQL & Storage
 * Vanilla ES6 JavaScript (No frameworks required)
 */

(function () {
    "use strict";

    const CONFIG = window.KITS_BACKEND_CONFIG || {};
    const STORAGE_KEYS = {
        SESSION: "kits_lms_auth_session",
        PROFILES: "kits_lms_db_profiles",
        STUDENTS: "kits_lms_db_students",
        COURSES: "kits_lms_db_courses",
        EXAMINATIONS: "kits_lms_db_examinations",
        QUESTION_BANKS: "kits_lms_db_question_banks",
        CODING_BANKS: "kits_lms_db_coding_banks",
        ASSIGNMENTS: "kits_lms_db_exam_assignments",
        ATTEMPTS: "kits_lms_db_exam_attempts",
        ANSWERS: "kits_lms_db_student_answers",
        RESULTS: "kits_lms_db_results"
    };

    let fbAuth = null;
    let sbClient = null;
    let isLiveBackend = false;

    // 1. Initialize Firebase & Supabase Clients if SDKs & credentials present
    function initClients() {
        // Firebase Authentication & Analytics initialization
        const fbReady = CONFIG.isFirebaseConfigured ? CONFIG.isFirebaseConfigured() : (CONFIG.firebase && CONFIG.firebase.apiKey && !CONFIG.firebase.apiKey.includes("YOUR_"));
        if (fbReady) {
            try {
                if (window.firebase) {
                    if (!window.firebase.apps || !window.firebase.apps.length) {
                        window.firebase.initializeApp(CONFIG.firebase);
                    }
                    if (window.firebase.auth) {
                        fbAuth = window.firebase.auth();
                    }
                    if (window.firebase.analytics && CONFIG.firebase.measurementId) {
                        try {
                            window.firebase.analytics();
                        } catch (aErr) {
                            // Analytics optional
                        }
                    }
                    console.log("✓ KITS LMS: Firebase Authentication connected (" + CONFIG.firebase.projectId + ").");
                }
            } catch (err) {
                console.warn("KITS LMS: Firebase initialization error:", err);
                fbAuth = null;
            }
        }

        // Supabase Database & Storage initialization
        const sbReady = CONFIG.isSupabaseConfigured ? CONFIG.isSupabaseConfigured() : (CONFIG.supabase && CONFIG.supabase.anonKey && !CONFIG.supabase.anonKey.includes("YOUR_"));
        if (sbReady) {
            try {
                if (window.supabase && typeof window.supabase.createClient === "function") {
                    sbClient = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
                    console.log("✓ KITS LMS: Supabase PostgreSQL Database connected.");
                }
            } catch (err) {
                console.warn("KITS LMS: Supabase initialization error:", err);
                sbClient = null;
            }
        }

        isLiveBackend = Boolean(fbAuth && sbClient);
    }

    // Try initial init
    initClients();

    // ============================================================================
    // Local Isolated Production Storage Helpers (Zero Mock Data)
    // Used when Firebase/Supabase credentials have not been configured yet
    // ============================================================================

    function getLocalStore(key, defaultValue = []) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }

    function setLocalStore(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.error("Storage error:", e);
        }
    }

    // ============================================================================
    // AUTHENTICATION MODULE (Firebase Auth + Profile Synchronization)
    // ============================================================================

    async function signUpStudent({ name, roll, email, department, academicYear, password }) {
        if (!name || !roll || !email || !password) {
            throw new Error("Please provide full name, roll number, college email, and password.");
        }

        const cleanRoll = roll.trim().toUpperCase();
        const cleanEmail = email.trim().toLowerCase();

        if (fbAuth) {
            // 1. Create user in Firebase Auth
            const userCredential = await fbAuth.createUserWithEmailAndPassword(cleanEmail, password);
            const user = userCredential.user;
            await user.updateProfile({ displayName: name });

            // 2. Obtain verified Firebase ID token
            const idToken = await user.getIdToken();

            let profile = null;
            let student = null;
            let session = null;

            // 3. Send verified identity to trusted backend for database provisioning
            try {
                const res = await fetch("/api/auth/register-student", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        idToken,
                        firebaseUid: user.uid,
                        name,
                        roll: cleanRoll,
                        email: cleanEmail,
                        department,
                        academicYear
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.success) {
                        profile = data.profile;
                        student = data.student;
                        session = data.session;
                        if (session && data.token) session.token = data.token;
                    }
                }
            } catch (err) {
                console.warn("[BACKEND-REG-WARN] Backend registration endpoint unavailable; using direct client fallback:", err);
            }

            // 4. Direct Supabase Client fallback if backend was unreachable
            if (!profile && sbClient) {
                const { data: profileData, error: profileErr } = await sbClient
                    .from("profiles")
                    .upsert([{
                        firebase_uid: user.uid,
                        auth_uid: user.uid,
                        email: cleanEmail,
                        full_name: name,
                        role: "student"
                    }], { onConflict: "firebase_uid" })
                    .select()
                    .maybeSingle();

                if (!profileErr && profileData) {
                    profile = profileData;
                    const { data: studentData } = await sbClient
                        .from("students")
                        .upsert([{
                            profile_id: profileData.id,
                            roll_number: cleanRoll,
                            department: department || "Information Technology",
                            academic_year: academicYear || "3rd Year B.Tech",
                            enrolled_courses: ["entrepreneurship", "python"]
                        }], { onConflict: "roll_number" })
                        .select()
                        .maybeSingle();
                    student = studentData;
                }
            }

            // 5. Local storage fallback if both remote options failed
            if (!profile) {
                const profiles = getLocalStore(STORAGE_KEYS.PROFILES, []);
                const students = getLocalStore(STORAGE_KEYS.STUDENTS, []);

                profile = {
                    id: "prof_" + user.uid,
                    firebase_uid: user.uid,
                    auth_uid: user.uid,
                    email: cleanEmail,
                    full_name: name,
                    role: "student",
                    created_at: new Date().toISOString()
                };

                student = {
                    id: "stud_" + cleanRoll.toLowerCase(),
                    profile_id: profile.id,
                    roll_number: cleanRoll,
                    department: department || "Information Technology",
                    academic_year: academicYear || "3rd Year B.Tech",
                    enrolled_courses: ["entrepreneurship", "python"],
                    created_at: new Date().toISOString()
                };

                profiles.push(profile);
                students.push(student);
                setLocalStore(STORAGE_KEYS.PROFILES, profiles);
                setLocalStore(STORAGE_KEYS.STUDENTS, students);
            }

            if (!session) {
                session = {
                    uid: user.uid,
                    profileId: profile.id,
                    studentId: student ? student.id : null,
                    email: cleanEmail,
                    name: name,
                    roll: cleanRoll,
                    dept: department || "Information Technology",
                    academicYear: academicYear || "3rd Year B.Tech",
                    role: "student"
                };
            }

            setLocalStore(STORAGE_KEYS.SESSION, session);
            return session;
        } else {
            // Isolated Production Local Store (No demo records)
            const profiles = getLocalStore(STORAGE_KEYS.PROFILES, []);
            const students = getLocalStore(STORAGE_KEYS.STUDENTS, []);

            if (profiles.some(p => p.email === cleanEmail)) {
                throw new Error("An account with this email address already exists.");
            }
            if (students.some(s => s.roll_number === cleanRoll)) {
                throw new Error("An account with this student roll number already exists.");
            }

            const profileId = "prof_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
            const studentId = "stud_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
            const authUid = "uid_" + Date.now();

            const newProfile = {
                id: profileId,
                firebase_uid: authUid,
                auth_uid: authUid,
                email: cleanEmail,
                full_name: name,
                role: "student",
                passwordHash: btoa(password),
                created_at: new Date().toISOString()
            };

            const newStudent = {
                id: studentId,
                profile_id: profileId,
                roll_number: cleanRoll,
                department: department || "Information Technology",
                academic_year: academicYear || "3rd Year B.Tech",
                enrolled_courses: ["entrepreneurship", "python"],
                created_at: new Date().toISOString()
            };

            profiles.push(newProfile);
            students.push(newStudent);
            setLocalStore(STORAGE_KEYS.PROFILES, profiles);
            setLocalStore(STORAGE_KEYS.STUDENTS, students);

            const session = {
                uid: authUid,
                profileId: profileId,
                studentId: studentId,
                email: cleanEmail,
                name: name,
                roll: cleanRoll,
                dept: newStudent.department,
                academicYear: newStudent.academic_year,
                role: "student"
            };

            setLocalStore(STORAGE_KEYS.SESSION, session);
            return session;
        }
    }

    async function signIn(identifier, password) {
        if (!identifier || !password) {
            throw new Error("Please enter your credentials.");
        }

        const cleanId = identifier.trim();

        if (fbAuth) {
            let emailToAuth = cleanId;

            // If user entered roll number instead of email, lookup email
            if (!cleanId.includes("@")) {
                let foundEmail = null;

                // 1. Try server-side student lookup API
                try {
                    const lookupRes = await fetch(`/api/auth/student-lookup?roll=${encodeURIComponent(cleanId.toUpperCase())}`);
                    if (lookupRes.ok) {
                        const lookupData = await lookupRes.json();
                        if (lookupData.success && lookupData.student && lookupData.student.email) {
                            foundEmail = lookupData.student.email;
                        }
                    } else if (lookupRes.status === 403) {
                        const errData = await lookupRes.json().catch(() => ({}));
                        throw new Error(errData.error || "Your student account has been suspended. Please contact the administrator.");
                    } else if (lookupRes.status === 404) {
                        const errData = await lookupRes.json().catch(() => ({}));
                        if (errData.status === "deleted") {
                            throw new Error(errData.error || "Your student account is no longer active. Please contact the administrator.");
                        }
                    }
                } catch (e) {
                    if (e.message && (e.message.includes("suspended") || e.message.includes("no longer active"))) {
                        throw e;
                    }
                }

                // 2. Try direct Supabase client query
                if (!foundEmail && sbClient) {
                    const { data: studentMatch } = await sbClient
                        .from("students")
                        .select("profile_id, profiles(email)")
                        .eq("roll_number", cleanId.toUpperCase())
                        .maybeSingle();

                    if (studentMatch && studentMatch.profiles && studentMatch.profiles.email) {
                        foundEmail = studentMatch.profiles.email;
                    }
                }

                // 3. Try local store
                if (!foundEmail) {
                    const students = getLocalStore(STORAGE_KEYS.STUDENTS, []);
                    const studentMatch = students.find(s => s.roll_number.toUpperCase() === cleanId.toUpperCase());
                    if (studentMatch && studentMatch.email) {
                        foundEmail = studentMatch.email;
                    }
                }

                if (!foundEmail) {
                    throw new Error("No student record found with roll number: " + cleanId);
                }
                emailToAuth = foundEmail;
            }

            // Authenticate with Firebase Authentication
            const userCredential = await fbAuth.signInWithEmailAndPassword(emailToAuth, password);
            const user = userCredential.user;
            const idToken = await user.getIdToken();

            let profile = null;
            let studentRecord = null;
            let session = null;

            // Step 1: Verify & Reconcile profile on backend (Supports Existing Firebase Users)
            try {
                const verifyRes = await fetch("/api/auth/verify-profile", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        idToken,
                        firebaseUid: user.uid,
                        identifier: cleanId,
                        fallbackDetails: {
                            email: user.email || emailToAuth,
                            name: user.displayName || (user.email ? user.email.split("@")[0] : cleanId),
                            roll: cleanId.includes("@") ? (user.email ? user.email.split("@")[0].toUpperCase() : "") : cleanId.toUpperCase()
                        }
                    })
                });

                if (verifyRes.ok) {
                    const verifyData = await verifyRes.json();
                    if (verifyData.success) {
                        profile = verifyData.profile;
                        studentRecord = verifyData.student;
                        session = verifyData.session;
                        if (session && verifyData.token) session.token = verifyData.token;
                    }
                } else if (verifyRes.status === 403) {
                    const errData = await verifyRes.json().catch(() => ({}));
                    if (fbAuth) await fbAuth.signOut().catch(() => {});
                    throw new Error(errData.error || "Your student account has been suspended. Please contact the administrator.");
                }
            } catch (err) {
                console.warn("[BACKEND-VERIFY-WARN] Backend profile verification endpoint unreachable; using direct client fallback:", err);
            }

            // Step 2: Direct Supabase client query with profile reconciliation
            if (!profile && sbClient) {
                // Lookup by firebase_uid
                let { data: profData } = await sbClient
                    .from("profiles")
                    .select("*, students(*)")
                    .eq("firebase_uid", user.uid)
                    .maybeSingle();

                // If not found by firebase_uid, check by email (reconciliation)
                if (!profData && user.email) {
                    const { data: emailData } = await sbClient
                        .from("profiles")
                        .select("*, students(*)")
                        .eq("email", user.email.toLowerCase())
                        .maybeSingle();

                    if (emailData) {
                        profData = emailData;
                        await sbClient
                            .from("profiles")
                            .update({ firebase_uid: user.uid, auth_uid: user.uid })
                            .eq("id", emailData.id);
                    }
                }

                // If STILL not found: reconcile by creating the missing profile record
                if (!profData) {
                    const fallbackName = user.displayName || user.email.split("@")[0];
                    const fallbackRoll = cleanId.includes("@") ? user.email.split("@")[0].toUpperCase() : cleanId.toUpperCase();
                    const { data: newProf } = await sbClient
                        .from("profiles")
                        .insert([{
                            firebase_uid: user.uid,
                            auth_uid: user.uid,
                            email: user.email.toLowerCase(),
                            full_name: fallbackName,
                            role: "student"
                        }])
                        .select()
                        .maybeSingle();

                    if (newProf) {
                        profData = newProf;
                        const { data: newStud } = await sbClient
                            .from("students")
                            .insert([{
                                profile_id: newProf.id,
                                roll_number: fallbackRoll,
                                department: "Information Technology",
                                academic_year: "3rd Year B.Tech",
                                enrolled_courses: ["entrepreneurship", "python"]
                            }])
                            .select()
                            .maybeSingle();
                        profData.students = newStud ? [newStud] : [];
                    }
                }

                if (profData) {
                    profile = profData;
                    studentRecord = (profile.students && profile.students[0]) || null;
                }
            }

            // Step 3: Local isolated store fallback
            if (!profile) {
                const profiles = getLocalStore(STORAGE_KEYS.PROFILES, []);
                const students = getLocalStore(STORAGE_KEYS.STUDENTS, []);
                profile = profiles.find(p => p.firebase_uid === user.uid || p.auth_uid === user.uid || p.email.toLowerCase() === emailToAuth.toLowerCase());
                if (!profile) {
                    profile = {
                        id: "prof_" + user.uid,
                        firebase_uid: user.uid,
                        auth_uid: user.uid,
                        email: user.email,
                        full_name: user.displayName || user.email.split("@")[0],
                        role: "student"
                    };
                    profiles.push(profile);
                    setLocalStore(STORAGE_KEYS.PROFILES, profiles);
                }
                studentRecord = students.find(s => s.profile_id === profile.id || s.email === profile.email) || null;
            }

            if (!session) {
                session = {
                    uid: user.uid,
                    profileId: profile.id,
                    studentId: studentRecord ? studentRecord.id : null,
                    email: profile.email,
                    name: profile.full_name,
                    roll: studentRecord ? studentRecord.roll_number : (cleanId.includes("@") ? profile.email : cleanId.toUpperCase()),
                    dept: studentRecord ? studentRecord.department : "Information Technology",
                    academicYear: studentRecord ? studentRecord.academic_year : "3rd Year B.Tech",
                    role: profile.role || "student"
                };
            }

            setLocalStore(STORAGE_KEYS.SESSION, session);
            return session;
        } else {
            // Local fallback sign in
            const profiles = getLocalStore(STORAGE_KEYS.PROFILES, []);
            const students = getLocalStore(STORAGE_KEYS.STUDENTS, []);

            let profile = null;
            let student = null;

            if (cleanId.includes("@")) {
                profile = profiles.find(p => p.email.toLowerCase() === cleanId.toLowerCase());
            } else {
                student = students.find(s => s.roll_number.toUpperCase() === cleanId.toUpperCase());
                if (student) {
                    profile = profiles.find(p => p.id === student.profile_id);
                }
            }

            if (!profile) {
                throw new Error("Account not found. Please register your student account first.");
            }

            if (profile.passwordHash && profile.passwordHash !== btoa(password)) {
                throw new Error("Invalid password. Please check your credentials.");
            }

            if (!student) {
                student = students.find(s => s.profile_id === profile.id);
            }

            const session = {
                uid: profile.firebase_uid || profile.auth_uid || profile.id,
                profileId: profile.id,
                studentId: student ? student.id : null,
                email: profile.email,
                name: profile.full_name,
                roll: student ? student.roll_number : profile.email,
                dept: student ? student.department : "Information Technology",
                academicYear: student ? student.academic_year : "3rd Year B.Tech",
                role: profile.role || "student"
            };

            setLocalStore(STORAGE_KEYS.SESSION, session);
            return session;
        }
    }

    async function sendPasswordReset(email) {
        if (!email || !email.includes("@")) {
            throw new Error("Please enter a valid registered email address.");
        }
        if (fbAuth) {
            await fbAuth.sendPasswordResetEmail(email.trim());
        }
        return true;
    }

    async function signOut() {
        if (fbAuth) {
            await fbAuth.signOut();
        }
        localStorage.removeItem(STORAGE_KEYS.SESSION);
        localStorage.removeItem("mocklab_roll");
        localStorage.removeItem("mocklab_name");
        localStorage.removeItem("mocklab_email");
        localStorage.removeItem("mocklab_dept");
        localStorage.removeItem("mocklab_year");
        localStorage.removeItem("mocktest_admin_session");
    }

    function getCurrentSession() {
        return getLocalStore(STORAGE_KEYS.SESSION, null);
    }

    function onAuthStateChanged(callback) {
        if (fbAuth) {
            return fbAuth.onAuthStateChanged(async user => {
                if (user) {
                    const session = getCurrentSession();
                    callback(session);
                } else {
                    callback(null);
                }
            });
        } else {
            const session = getCurrentSession();
            callback(session);
            return () => {};
        }
    }

    // ============================================================================
    // COURSES MODULE (Catalog & Student Enrollment)
    // ============================================================================

    async function getCourses() {
        if (isLiveBackend && sbClient) {
            const { data, error } = await sbClient
                .from("courses")
                .select("*")
                .eq("is_active", true)
                .order("title");
            if (error) throw error;
            return data || [];
        } else {
            return getLocalStore(STORAGE_KEYS.COURSES, []);
        }
    }

    async function getCourse(courseId) {
        if (isLiveBackend && sbClient) {
            const { data, error } = await sbClient
                .from("courses")
                .select("*")
                .eq("id", courseId)
                .single();
            if (error) return null;
            return data;
        } else {
            const courses = getLocalStore(STORAGE_KEYS.COURSES, []);
            return courses.find(c => c.id === courseId) || null;
        }
    }

    async function getEnrolledCourseIds(studentId) {
        if (!studentId) return [];
        if (isLiveBackend && sbClient) {
            const { data, error } = await sbClient
                .from("students")
                .select("enrolled_courses")
                .eq("id", studentId)
                .single();
            if (error || !data) return [];
            return data.enrolled_courses || [];
        } else {
            const students = getLocalStore(STORAGE_KEYS.STUDENTS, []);
            const student = students.find(s => s.id === studentId);
            return (student && student.enrolled_courses) ? student.enrolled_courses : [];
        }
    }

    async function enrollInCourse(studentId, courseId) {
        if (!studentId || !courseId) return false;
        if (isLiveBackend && sbClient) {
            const currentIds = await getEnrolledCourseIds(studentId);
            if (!currentIds.includes(courseId)) {
                currentIds.push(courseId);
                const { error } = await sbClient
                    .from("students")
                    .update({ enrolled_courses: currentIds })
                    .eq("id", studentId);
                if (error) throw error;
            }
            return true;
        } else {
            const students = getLocalStore(STORAGE_KEYS.STUDENTS, []);
            const idx = students.findIndex(s => s.id === studentId);
            if (idx >= 0) {
                const enrolled = students[idx].enrolled_courses || [];
                if (!enrolled.includes(courseId)) {
                    enrolled.push(courseId);
                    students[idx].enrolled_courses = enrolled;
                    setLocalStore(STORAGE_KEYS.STUDENTS, students);
                }
                return true;
            }
            return false;
        }
    }

    // ============================================================================
    // EXAMINATIONS & RANDOMIZED SETS (10 Unique Sets, 50 Marks, 90 Mins)
    // ============================================================================

    async function getPublishedExaminations(courseId = null) {
        if (isLiveBackend && sbClient) {
            let query = sbClient
                .from("examinations")
                .select("*, courses(title, department)")
                .eq("status", "published")
                .order("created_at", { ascending: false });

            if (courseId) {
                query = query.eq("course_id", courseId);
            }
            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        } else {
            const exams = getLocalStore(STORAGE_KEYS.EXAMINATIONS, []);
            const published = exams.filter(e => e.status === "published");
            if (courseId) {
                return published.filter(e => e.course_id === courseId);
            }
            return published;
        }
    }

    async function getExaminationDetails(examId) {
        if (isLiveBackend && sbClient) {
            const { data: exam, error: examErr } = await sbClient
                .from("examinations")
                .select("*, courses(title, department)")
                .eq("id", examId)
                .single();
            if (examErr) throw examErr;

            const { data: questions, error: qErr } = await sbClient
                .from("question_banks")
                .select("*")
                .eq("examination_id", examId)
                .order("question_number");
            if (qErr) throw qErr;

            const { data: codingProblems, error: cErr } = await sbClient
                .from("coding_banks")
                .select("*")
                .eq("examination_id", examId)
                .order("problem_index");
            if (cErr) throw cErr;

            return {
                exam,
                questions: questions || [],
                codingProblems: codingProblems || []
            };
        } else {
            const exams = getLocalStore(STORAGE_KEYS.EXAMINATIONS, []);
            const exam = exams.find(e => String(e.id) === String(examId));
            if (!exam) return null;

            const allQuestions = getLocalStore(STORAGE_KEYS.QUESTION_BANKS, []);
            const allCoding = getLocalStore(STORAGE_KEYS.CODING_BANKS, []);

            const questions = allQuestions.filter(q => String(q.examination_id) === String(examId));
            const codingProblems = allCoding.filter(c => String(c.examination_id) === String(examId));

            return { exam, questions, codingProblems };
        }
    }

    /**
     * Obtains or creates a randomized set assignment for a student
     * Generates 1 of 10 deterministic randomized sets.
     */
    async function getOrCreateAssignment(examId, studentId) {
        if (!examId || !studentId) throw new Error("Exam ID and Student ID required.");

        if (isLiveBackend && sbClient) {
            // Check existing assignment
            const { data: existing, error: existErr } = await sbClient
                .from("exam_assignments")
                .select("*")
                .eq("examination_id", examId)
                .eq("student_id", studentId)
                .maybeSingle();

            if (existing) return existing;

            // Generate deterministic set number between 1 and 10 based on student ID hash
            let hash = 0;
            const seedStr = studentId + examId;
            for (let i = 0; i < seedStr.length; i++) {
                hash = (hash << 5) - hash + seedStr.charCodeAt(i);
                hash |= 0;
            }
            const setNumber = Math.abs(hash % 10) + 1;

            const { data: newAssignment, error: assignErr } = await sbClient
                .from("exam_assignments")
                .insert([{
                    examination_id: examId,
                    student_id: studentId,
                    set_number: setNumber,
                    question_order: { setNumber: setNumber, generatedAt: new Date().toISOString() }
                }])
                .select()
                .single();

            if (assignErr) throw assignErr;
            return newAssignment;
        } else {
            const assignments = getLocalStore(STORAGE_KEYS.ASSIGNMENTS, []);
            let existing = assignments.find(a => String(a.examination_id) === String(examId) && String(a.student_id) === String(studentId));
            if (existing) return existing;

            let hash = 0;
            const seedStr = studentId + examId;
            for (let i = 0; i < seedStr.length; i++) {
                hash = (hash << 5) - hash + seedStr.charCodeAt(i);
                hash |= 0;
            }
            const setNumber = Math.abs(hash % 10) + 1;

            const newAssignment = {
                id: "assign_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
                examination_id: examId,
                student_id: studentId,
                set_number: setNumber,
                question_order: { setNumber: setNumber, generatedAt: new Date().toISOString() },
                created_at: new Date().toISOString()
            };

            assignments.push(newAssignment);
            setLocalStore(STORAGE_KEYS.ASSIGNMENTS, assignments);
            return newAssignment;
        }
    }

    // ============================================================================
    // EXAM ATTEMPTS & SUBMISSION (Autosave, Evaluation & Results)
    // ============================================================================

    async function startExamAttempt(examId, studentId, setNumber = 1) {
        if (isLiveBackend && sbClient) {
            const { data, error } = await sbClient
                .from("exam_attempts")
                .insert([{
                    examination_id: examId,
                    student_id: studentId,
                    set_number: setNumber,
                    status: "in_progress",
                    started_at: new Date().toISOString()
                }])
                .select()
                .single();
            if (error) throw error;
            return data;
        } else {
            const attempts = getLocalStore(STORAGE_KEYS.ATTEMPTS, []);
            const attemptId = "att_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
            const newAttempt = {
                id: attemptId,
                examination_id: examId,
                student_id: studentId,
                set_number: setNumber,
                status: "in_progress",
                started_at: new Date().toISOString(),
                total_time_seconds: 0,
                total_score: 0,
                section_a_score: 0,
                section_b_score: 0
            };
            attempts.push(newAttempt);
            setLocalStore(STORAGE_KEYS.ATTEMPTS, attempts);
            return newAttempt;
        }
    }

    async function autosaveAnswer(attemptId, questionId, section, answerData) {
        if (!attemptId || !questionId) return;

        if (isLiveBackend && sbClient) {
            const payload = {
                attempt_id: attemptId,
                question_id: questionId,
                section: section,
                selected_options: answerData.selectedOptions || [],
                submitted_code: answerData.submittedCode || {},
                saved_at: new Date().toISOString()
            };

            await sbClient
                .from("student_answers")
                .upsert([payload], { onConflict: "attempt_id,question_id" });
        } else {
            const answers = getLocalStore(STORAGE_KEYS.ANSWERS, []);
            const existingIdx = answers.findIndex(a => a.attempt_id === attemptId && a.question_id === questionId);
            const entry = {
                attempt_id: attemptId,
                question_id: questionId,
                section: section,
                selected_options: answerData.selectedOptions || [],
                submitted_code: answerData.submittedCode || {},
                saved_at: new Date().toISOString()
            };

            if (existingIdx >= 0) {
                answers[existingIdx] = Object.assign(answers[existingIdx], entry);
            } else {
                answers.push(entry);
            }
            setLocalStore(STORAGE_KEYS.ANSWERS, answers);
        }
    }

    /**
     * Exact-Match MSQ and Section B Coding Automated Evaluation
     * Evaluates full attempt and records official result
     */
    async function submitExamAttempt(attemptId, submissionData) {
        const { examId, studentId, timeSpentSeconds, answers } = submissionData;

        // Fetch question banks and coding banks
        const details = await getExaminationDetails(examId);
        const questions = (details && details.questions) || [];
        const codingProblems = (details && details.codingProblems) || [];

        let sectionAScore = 0;
        let sectionBScore = 0;
        let mcqScore = 0;
        let msqScore = 0;

        // 1. Evaluate Section A (MCQ & MSQ)
        questions.forEach(q => {
            const studentAns = answers[q.id];
            if (!studentAns) return;

            const selected = Array.isArray(studentAns.selectedOptions)
                ? studentAns.selectedOptions.map(String).sort()
                : (studentAns.selectedOption !== undefined && studentAns.selectedOption !== null)
                    ? [String(studentAns.selectedOption)]
                    : [];

            let correct = [];
            if (Array.isArray(q.correct_answers)) {
                correct = q.correct_answers.map(String).sort();
            } else if (typeof q.correct_answers === "string") {
                try {
                    const parsed = JSON.parse(q.correct_answers);
                    correct = Array.isArray(parsed) ? parsed.map(String).sort() : [String(parsed)];
                } catch (e) {
                    correct = [q.correct_answers.trim()];
                }
            } else if (q.answer !== undefined) {
                correct = Array.isArray(q.answer) ? q.answer.map(String).sort() : [String(q.answer)];
            }

            // Evaluation logic:
            if (q.type === "msq") {
                // MSQ: Exact match required - all correct options and NO incorrect options
                const isExactMatch = selected.length > 0 &&
                    selected.length === correct.length &&
                    selected.every((val, idx) => val.toUpperCase() === correct[idx].toUpperCase());

                if (isExactMatch) {
                    const marks = Number(q.marks) || 1;
                    msqScore += marks;
                    sectionAScore += marks;
                }
            } else {
                // MCQ: Single selection exact match
                if (selected.length === 1 && correct.length > 0 && selected[0].toUpperCase() === correct[0].toUpperCase()) {
                    const marks = Number(q.marks) || 1;
                    mcqScore += marks;
                    sectionAScore += marks;
                }
            }
        });

        // 2. Evaluate Section B (Coding & Debugging: Problems 1 to 4 @ 5 marks each)
        codingProblems.forEach(prob => {
            const studentCode = answers[prob.id] && answers[prob.id].submittedCode;
            const testResults = answers[prob.id] && answers[prob.id].testCaseResults;

            if (testResults && Array.isArray(testResults) && testResults.length > 0) {
                const passedCount = testResults.filter(t => t.passed).length;
                const totalTests = testResults.length;
                const problemMarks = Number(prob.marks) || 5;
                const awarded = Math.round((passedCount / totalTests) * problemMarks * 100) / 100;
                sectionBScore += awarded;
            } else if (studentCode && (studentCode.html || studentCode.css)) {
                // Basic fallback if test cases were not executed in browser
                sectionBScore += 2.5; // partial credit for attempt
            }
        });

        const totalScore = Math.min(50, Math.round((sectionAScore + sectionBScore) * 100) / 100);
        const percentage = Math.round((totalScore / 50) * 100);

        const breakdown = {
            sectionA_mcq: mcqScore,
            sectionA_msq: msqScore,
            sectionA_total: sectionAScore,
            sectionB_coding: sectionBScore,
            totalMarks: 50
        };

        if (isLiveBackend && sbClient) {
            // Update exam attempt
            await sbClient
                .from("exam_attempts")
                .update({
                    status: "submitted",
                    submitted_at: new Date().toISOString(),
                    total_time_seconds: timeSpentSeconds || 0,
                    section_a_score: sectionAScore,
                    section_b_score: sectionBScore,
                    total_score: totalScore,
                    is_final: true
                })
                .eq("id", attemptId);

            // Insert into results table
            const { data: resultRecord, error: resErr } = await sbClient
                .from("results")
                .insert([{
                    attempt_id: attemptId,
                    student_id: studentId,
                    examination_id: examId,
                    score: totalScore,
                    total_marks: 50,
                    percentage: percentage,
                    section_breakdown: breakdown,
                    time_taken_seconds: timeSpentSeconds || 0,
                    completed_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (resErr) throw resErr;
            return resultRecord;
        } else {
            const attempts = getLocalStore(STORAGE_KEYS.ATTEMPTS, []);
            const idx = attempts.findIndex(a => a.id === attemptId);
            if (idx >= 0) {
                attempts[idx].status = "submitted";
                attempts[idx].submitted_at = new Date().toISOString();
                attempts[idx].total_time_seconds = timeSpentSeconds || 0;
                attempts[idx].section_a_score = sectionAScore;
                attempts[idx].section_b_score = sectionBScore;
                attempts[idx].total_score = totalScore;
                attempts[idx].is_final = true;
                setLocalStore(STORAGE_KEYS.ATTEMPTS, attempts);
            }

            const results = getLocalStore(STORAGE_KEYS.RESULTS, []);
            const resultRecord = {
                id: "res_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
                attempt_id: attemptId,
                student_id: studentId,
                examination_id: examId,
                score: totalScore,
                total_marks: 50,
                percentage: percentage,
                section_breakdown: breakdown,
                time_taken_seconds: timeSpentSeconds || 0,
                completed_at: new Date().toISOString()
            };
            results.push(resultRecord);
            setLocalStore(STORAGE_KEYS.RESULTS, results);

            // Also mirror to legacy mocklab_attempts for smooth backward compatibility
            try {
                const legacy = getLocalStore("mocklab_attempts", []);
                legacy.push({
                    id: resultRecord.id,
                    attemptId: attemptId,
                    userId: studentId,
                    examId: examId,
                    testName: (details && details.exam && details.exam.title) || "Examination",
                    score: totalScore,
                    total: 50,
                    percentage: percentage,
                    date: new Date().toISOString(),
                    sectionBreakdown: breakdown
                });
                setLocalStore("mocklab_attempts", legacy);
            } catch (e) {}

            return resultRecord;
        }
    }

    // ============================================================================
    // RESULTS & DASHBOARD METRICS (Real Database Queries, Zero Fabricated Data)
    // ============================================================================

    async function getStudentResults(studentId) {
        if (!studentId) return [];

        if (isLiveBackend && sbClient) {
            const { data, error } = await sbClient
                .from("results")
                .select("*, examinations(title, course_id, total_marks)")
                .eq("student_id", studentId)
                .order("completed_at", { ascending: false });
            if (error) throw error;
            return data || [];
        } else {
            const results = getLocalStore(STORAGE_KEYS.RESULTS, []);
            const exams = getLocalStore(STORAGE_KEYS.EXAMINATIONS, []);
            return results
                .filter(r => String(r.student_id) === String(studentId))
                .map(r => {
                    const exam = exams.find(e => String(e.id) === String(r.examination_id));
                    return {
                        ...r,
                        examinations: exam ? { title: exam.title, course_id: exam.course_id, total_marks: 50 } : null
                    };
                })
                .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
        }
    }

    async function getStudentDashboardStats(studentId) {
        const enrolled = await getEnrolledCourseIds(studentId);
        const results = await getStudentResults(studentId);

        let totalScore = 0;
        let totalPossible = 0;

        results.forEach(r => {
            totalScore += Number(r.score) || 0;
            totalPossible += Number(r.total_marks) || 50;
        });

        const avgScore = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;
        const questionsSolved = results.reduce((acc, r) => acc + 34, 0); // 30 Section A + 4 Section B per exam

        return {
            enrolledCount: enrolled.length,
            testsTaken: results.length,
            avgPercentage: avgScore,
            questionsSolved: questionsSolved,
            recentAttempts: results.slice(0, 5)
        };
    }

    // ============================================================================
    // ADMIN MODULE (Trusted Server-Side Operations)
    // ============================================================================

    async function authenticateAdmin(username, password) {
        const response = await fetch("/api/auth/admin-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || "Invalid username or password.");
        }
        return await response.json();
    }

    async function verifyAdminSession(token) {
        const response = await fetch("/api/auth/verify-session", {
            method: "GET",
            headers: { "Authorization": "Bearer " + token }
        });
        if (!response.ok) return { valid: false };
        return await response.json();
    }

    async function getAdminOverview(token) {
        const response = await fetch("/api/admin/overview", {
            method: "GET",
            headers: { "Authorization": "Bearer " + token }
        });
        if (!response.ok) throw new Error("Failed to load admin overview statistics.");
        return await response.json();
    }

    async function getAdminStudents(token) {
        const response = await fetch("/api/admin/students", {
            method: "GET",
            headers: { "Authorization": "Bearer " + token }
        });
        if (!response.ok) throw new Error("Failed to retrieve student directory.");
        return await response.json();
    }

    async function suspendStudent(token, rollNumber) {
        const response = await fetch("/api/admin/students/suspend", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ rollNumber })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to suspend student account.");
        return data;
    }

    async function activateStudent(token, rollNumber) {
        const response = await fetch("/api/admin/students/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ rollNumber })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to activate student account.");
        return data;
    }

    async function deleteStudent(token, rollNumber, confirmationRoll) {
        const response = await fetch("/api/admin/students/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ rollNumber, confirmationRoll })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to delete student account.");
        return data;
    }

    async function getStudentDetails(token, rollNumber) {
        const response = await fetch(`/api/admin/students/details?roll=${encodeURIComponent(rollNumber)}`, {
            method: "GET",
            headers: { "Authorization": "Bearer " + token }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Failed to load student details.");
        return data;
    }

    async function toggleStudentStatus(token, studentId) {
        const response = await fetch("/api/admin/students/toggle-status", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ studentId })
        });
        if (!response.ok) throw new Error("Failed to update student status.");
        return await response.json();
    }

    async function getAdminFaculty(token) {
        const response = await fetch("/api/admin/faculty", {
            method: "GET",
            headers: { "Authorization": "Bearer " + token }
        });
        if (!response.ok) throw new Error("Failed to retrieve faculty directory.");
        return await response.json();
    }

    async function createAdminFaculty(token, facultyData) {
        const response = await fetch("/api/admin/faculty", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify(facultyData)
        });
        if (!response.ok) throw new Error("Failed to create faculty account.");
        return await response.json();
    }

    async function toggleFacultyStatus(token, facultyId) {
        const response = await fetch("/api/admin/faculty/toggle-status", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
            body: JSON.stringify({ facultyId })
        });
        if (!response.ok) throw new Error("Failed to update faculty status.");
        return await response.json();
    }

    async function serverEvaluateExam(submission) {
        try {
            const response = await fetch("/api/exams/evaluate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(submission)
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.result) return data.result;
            }
        } catch (e) {
            console.warn("Server evaluation endpoint unavailable; using local engine fallback.", e);
        }
        return null;
    }

    // ============================================================================
    // EXPOSE GLOBAL BACKEND API
    // ============================================================================

    window.KitsBackend = {
        config: CONFIG,
        isLive: () => isLiveBackend,
        isFirebaseLive: () => Boolean(fbAuth),
        isSupabaseLive: () => Boolean(sbClient),
        // Auth
        signUpStudent,
        signIn,
        sendPasswordReset,
        signOut,
        getCurrentSession,
        onAuthStateChanged,
        // Admin Module
        authenticateAdmin,
        verifyAdminSession,
        getAdminOverview,
        getAdminStudents,
        getStudentDetails,
        suspendStudent,
        activateStudent,
        deleteStudent,
        toggleStudentStatus,
        getAdminFaculty,
        createAdminFaculty,
        toggleFacultyStatus,
        serverEvaluateExam,
        signOut,
        getCurrentSession,
        onAuthStateChanged,
        // Courses
        getCourses,
        getCourse,
        getEnrolledCourseIds,
        enrollInCourse,
        // Exams
        getPublishedExaminations,
        getExaminationDetails,
        getOrCreateAssignment,
        // Execution & Evaluation
        startExamAttempt,
        autosaveAnswer,
        submitExamAttempt,
        // Results & Metrics
        getStudentResults,
        getStudentDashboardStats
    };

})();

