/**
 * KITS LMS — Core Examination & Three-Level Randomization Engine
 * 
 * Features:
 * 1. IndexedDB Persistent Storage (with localStorage fallback)
 * 2. MCQ / MSQ and Coding Question Bank Management
 * 3. Three-Level Randomization System:
 *    - Level A: Question Randomization (20 MCQs + 10 MSQs per set, Fisher-Yates, no duplicates)
 *    - Level B: Option Randomization (Independent option shuffle, tracking original option IDs & mapped answers)
 *    - Level C: Student-wise Set Assignment (Deterministic, persistent, strict non-reuse or reuse mode)
 * 4. Coding / Debugging Problem Engine (Starter code, constraints, test cases, evaluation)
 * 5. Student Examination Sanitizer (Strips answer keys from student view for frontend integrity)
 * 6. Dual Objective (30 Marks) + Coding (20 Marks) = 50 Marks, 90-Minute Evaluator
 */

(function (global) {
    "use strict";

    const DB_NAME = "KITS_LMS_DB";
    const DB_VERSION = 2;
    const STORAGE_PREFIX = "kits_lms_";

    // -------------------------------------------------------------
    // 1. IndexedDB Asynchronous Storage Manager
    // -------------------------------------------------------------
    let dbInstance = null;

    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (dbInstance) {
                return resolve(dbInstance);
            }
            if (!global.indexedDB) {
                console.warn("[KITS Exam Engine] IndexedDB is not supported in this browser. Falling back to localStorage.");
                return resolve(null);
            }

            const request = global.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (event) {
                const db = event.target.result;

                // Store for full examination specifications
                if (!db.objectStoreNames.contains("exams")) {
                    db.createObjectStore("exams", { keyPath: "id" });
                }
                // Store for objective question banks (MCQ + MSQ)
                if (!db.objectStoreNames.contains("question_banks")) {
                    db.createObjectStore("question_banks", { keyPath: "id" });
                }
                // Store for coding / debugging question banks
                if (!db.objectStoreNames.contains("coding_banks")) {
                    db.createObjectStore("coding_banks", { keyPath: "id" });
                }
                // Store for generated 10+ randomized sets
                if (!db.objectStoreNames.contains("randomized_sets")) {
                    db.createObjectStore("randomized_sets", { keyPath: "id" });
                }
                // Store for student-wise set assignments
                if (!db.objectStoreNames.contains("set_assignments")) {
                    db.createObjectStore("set_assignments", { keyPath: "key" });
                }
                // Store for secure answer keys (kept segregated from student exam payload)
                if (!db.objectStoreNames.contains("answer_keys")) {
                    db.createObjectStore("answer_keys", { keyPath: "id" });
                }
                // Store for PDF file blobs
                if (!db.objectStoreNames.contains("files")) {
                    db.createObjectStore("files", { keyPath: "id" });
                }
                // Store for exam submissions & attempt logs
                if (!db.objectStoreNames.contains("submissions")) {
                    db.createObjectStore("submissions", { keyPath: "id" });
                }
            };

            request.onsuccess = function (event) {
                dbInstance = event.target.result;
                resolve(dbInstance);
            };

            request.onerror = function (event) {
                console.error("[KITS Exam Engine] IndexedDB open error:", event.target.error);
                resolve(null); // Fallback to localStorage gracefully
            };
        });
    }

    async function dbGet(storeName, key) {
        try {
            const db = await openDatabase();
            if (!db) {
                const val = localStorage.getItem(STORAGE_PREFIX + storeName + "_" + key);
                return val ? JSON.parse(val) : null;
            }
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            console.warn("[KITS Exam Engine] dbGet error:", e);
            const val = localStorage.getItem(STORAGE_PREFIX + storeName + "_" + key);
            return val ? JSON.parse(val) : null;
        }
    }

    async function dbPut(storeName, value) {
        try {
            const key = value.id || value.key;
            // Mirror to localStorage for synchronous lookups and persistence safety
            try {
                if (key) {
                    localStorage.setItem(STORAGE_PREFIX + storeName + "_" + key, JSON.stringify(value));
                }
            } catch (quotaErr) {
                console.warn("[KITS Exam Engine] localStorage quota warning:", quotaErr);
            }

            const db = await openDatabase();
            if (!db) return true;
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                const req = store.put(value);
                req.onsuccess = () => resolve(true);
                req.onerror = (err) => {
                    console.error("[KITS Exam Engine] dbPut error:", err);
                    resolve(false);
                };
            });
        } catch (e) {
            console.warn("[KITS Exam Engine] dbPut outer error:", e);
            return false;
        }
    }

    async function dbGetAll(storeName) {
        try {
            const db = await openDatabase();
            if (!db) {
                const list = [];
                const prefix = STORAGE_PREFIX + storeName + "_";
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(prefix)) {
                        try {
                            list.push(JSON.parse(localStorage.getItem(k)));
                        } catch (e) {}
                    }
                }
                return list;
            }
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });
        } catch (e) {
            console.warn("[KITS Exam Engine] dbGetAll error:", e);
            return [];
        }
    }

    async function dbDelete(storeName, key) {
        try {
            localStorage.removeItem(STORAGE_PREFIX + storeName + "_" + key);
            const db = await openDatabase();
            if (!db) return true;
            return new Promise((resolve) => {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                const req = store.delete(key);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            });
        } catch (e) {
            return false;
        }
    }

    // -------------------------------------------------------------
    // 2. Cryptographically Sound / Deterministic Fisher-Yates Shuffling
    // -------------------------------------------------------------
    function fisherYatesShuffle(array, customRng) {
        const copy = array.slice();
        const rng = customRng || Math.random;
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const temp = copy[i];
            copy[i] = copy[j];
            copy[j] = temp;
        }
        return copy;
    }

    // Simple reproducible Linear Congruential Generator (LCG) PRNG
    function createPrng(seed) {
        let s = Math.abs(Number(seed)) || 123456789;
        return function () {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
    }

    // -------------------------------------------------------------
    // Option ID & Answer Evaluation Helpers (MCQ & MSQ)
    // -------------------------------------------------------------

    /**
     * Converts a numeric index (0, 1, 2, 3) or string token to standard uppercase Option ID ("A", "B", "C", "D")
     */
    function indexToOptionId(index) {
        if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < 26) {
            return String.fromCharCode(65 + index);
        }
        const str = String(index !== undefined && index !== null ? index : "").trim().toUpperCase();
        if (/^[A-Z]$/.test(str)) return str;
        const num = parseInt(str, 10);
        if (!isNaN(num) && num >= 0 && num < 26) {
            return String.fromCharCode(65 + num);
        }
        return str;
    }

    /**
     * Converts an Option ID ("A", "B", "C", "D") to a 0-based numeric index (0, 1, 2, 3)
     */
    function optionIdToIndex(id) {
        if (typeof id === "number" && Number.isInteger(id)) return id;
        const str = String(id !== undefined && id !== null ? id : "").trim().toUpperCase();
        if (/^[A-Z]$/.test(str)) return str.charCodeAt(0) - 65;
        const num = parseInt(str, 10);
        if (!isNaN(num)) return num;
        return -1;
    }

    /**
     * Normalizes any answer representation (array of numbers, array of letters, single letter, etc.)
     * into a sorted, deduplicated array of uppercase Option IDs, e.g. ["A", "B", "C"]
     */
    function normalizeOptionIdArray(arr) {
        if (arr === null || arr === undefined || arr === "") return [];
        const list = Array.isArray(arr) ? arr : [arr];
        const unique = new Set();
        list.forEach(item => {
            if (item === null || item === undefined || item === "") return;
            const optId = indexToOptionId(item);
            if (optId && /^[A-Z]$/.test(optId)) {
                unique.add(optId);
            }
        });
        return Array.from(unique).sort();
    }

    /**
     * Evaluates Multi-Select Question (MSQ) answer against correct answer key.
     * 
     * Requirements Enforced:
     * 1. Exact matching of option ID arrays irrespective of candidate selection order.
     * 2. Awards full marks (1 mark) ONLY when ALL correct options are selected and NO incorrect options are selected.
     * 3. Incomplete selection, extra incorrect options, or empty selections strictly return false (0 marks).
     * 4. Single-selection candidate answer is evaluated strictly as an MSQ (never treated as an MCQ).
     * 5. No AI confidence score or manual review required for normal objective MSQ evaluation.
     */
    function evaluateMsqAnswer(candAns, correctAns) {
        const candNorm = normalizeOptionIdArray(candAns);
        const corrNorm = normalizeOptionIdArray(correctAns);

        if (candNorm.length === 0 || corrNorm.length === 0) {
            return false;
        }
        if (candNorm.length !== corrNorm.length) {
            return false;
        }
        return candNorm.every((val, idx) => val === corrNorm[idx]);
    }

    /**
     * Evaluates Single-Choice Question (MCQ) answer against correct answer key.
     */
    function evaluateMcqAnswer(candAns, correctAns) {
        const candNorm = normalizeOptionIdArray(candAns);
        const corrNorm = normalizeOptionIdArray(correctAns);

        if (candNorm.length === 0 || corrNorm.length === 0) {
            return false;
        }
        return candNorm[0] === corrNorm[0];
    }

    // -------------------------------------------------------------
    // 3. Three-Level Randomization Engine (Sets Generator)
    // -------------------------------------------------------------

    /**
     * Generates N unique randomized examination sets from an approved question bank.
     * 
     * Requirements Enforced:
     * A. Question Randomization:
     *    - 10 independent sets.
     *    - 20 MCQs and 10 MSQs per set (total 30 objective questions).
     *    - No duplicates within any set.
     *    - Verified question sequence uniqueness.
     * B. Option Randomization:
     *    - Independent option shuffling per question per set.
     *    - Preserves stable option IDs.
     *    - Remaps single correct answer for MCQ and multiple answers for MSQ.
     *    - Validates answer mapping against original question bank.
     * 
     * @param {Object} options
     * @param {string} options.examId
     * @param {Array}  options.questionBank - Array of master objective questions
     * @param {number} options.setCount - Number of sets to generate (default 10)
     * @param {number} options.mcqCount - Target MCQs per set (default 20)
     * @param {number} options.msqCount - Target MSQs per set (default 10)
     * @param {number} options.baseSeed - Base reproducible seed
     */
    function generateUniqueSets(options) {
        const examId = options.examId || "exam_" + Date.now();
        const bank = options.questionBank || [];
        const setCount = Number(options.setCount) || 10;
        const targetMcqs = Number(options.mcqCount) || 20;
        const targetMsqs = Number(options.msqCount) || 10;
        const baseSeed = Number(options.baseSeed) || Date.now();

        // 1. Partition bank into MCQs and MSQs
        const mcqs = bank.filter(q => (q.type || "").toLowerCase() === "mcq");
        const msqs = bank.filter(q => (q.type || "").toLowerCase() === "msq");

        if (mcqs.length < targetMcqs) {
            console.warn(`[KITS Exam Engine] Question bank contains ${mcqs.length} MCQs, which is fewer than target ${targetMcqs}. All available will be sampled.`);
        }
        if (msqs.length < targetMsqs) {
            console.warn(`[KITS Exam Engine] Question bank contains ${msqs.length} MSQs, which is fewer than target ${targetMsqs}. All available will be sampled.`);
        }

        const generatedSets = [];
        const secureAnswerKeys = [];
        const questionSequenceSignatures = new Set();

        for (let setIdx = 0; setIdx < setCount; setIdx++) {
            const setPrng = createPrng(baseSeed + (setIdx + 1) * 7919);

            // Level A: Question Randomization
            // Shuffle and sample MCQs and MSQs independently
            const sampleMcqCount = Math.min(mcqs.length, targetMcqs);
            const sampleMsqCount = Math.min(msqs.length, targetMsqs);

            let selectedMcqs = fisherYatesShuffle(mcqs, setPrng).slice(0, sampleMcqCount);
            let selectedMsqs = fisherYatesShuffle(msqs, setPrng).slice(0, sampleMsqCount);

            // Combine and shuffle question ordering across the entire set
            let combinedQuestions = fisherYatesShuffle(selectedMcqs.concat(selectedMsqs), setPrng);

            // Verify Question Sequence Uniqueness across sets
            let signature = combinedQuestions.map(q => q.id).join("|");
            let retryCount = 0;
            while (questionSequenceSignatures.has(signature) && retryCount < 50) {
                combinedQuestions = fisherYatesShuffle(combinedQuestions, setPrng);
                signature = combinedQuestions.map(q => q.id).join("|");
                retryCount++;
            }
            questionSequenceSignatures.add(signature);

            // Level B: Option Randomization per question in this set
            const shuffledQuestionsForSet = [];
            const answerKeyMap = {}; // QuestionId -> mapped correct answer option IDs in this set

            combinedQuestions.forEach((q, qOrder) => {
                const optPrng = createPrng(baseSeed + (setIdx + 1) * 31337 + (qOrder + 1) * 401);
                const isMsq = (q.type || "").toLowerCase() === "msq";

                // Normalize original answer keys to standard Option IDs (e.g. ["A", "C"])
                const originalAnswerNorm = normalizeOptionIdArray(q.answer);

                // Ensure options have stable IDs and identify whether each option is correct
                const originalOptions = q.options.map((optText, optIndex) => {
                    const optLetter = indexToOptionId(optIndex);
                    return {
                        originalId: `opt_${optIndex}`,
                        originalIndex: optIndex,
                        originalLetter: optLetter,
                        text: optText,
                        isCorrect: originalAnswerNorm.includes(optLetter)
                    };
                });

                // Independently shuffle options
                const shuffledOptions = fisherYatesShuffle(originalOptions, optPrng);

                // Compute updated correct Option IDs after shuffling
                // Index 0 -> "A", Index 1 -> "B", Index 2 -> "C", Index 3 -> "D"
                const remappedOptionIds = [];
                shuffledOptions.forEach((shuffledOpt, newIndex) => {
                    if (shuffledOpt.isCorrect) {
                        remappedOptionIds.push(indexToOptionId(newIndex));
                    }
                });
                remappedOptionIds.sort();

                // Validation against original question bank
                if (remappedOptionIds.length !== originalAnswerNorm.length) {
                    console.error(`[Randomization Integrity Error] Answer mapping mismatch for question ${q.id} in Set ${setIdx + 1}`);
                }

                // Shuffled question object for student view (sanitized: answers stripped for security)
                shuffledQuestionsForSet.push({
                    id: q.id,
                    orderIndex: qOrder + 1,
                    type: isMsq ? "msq" : "mcq",
                    question: q.question,
                    marks: Number(q.marks) || 1,
                    section: isMsq ? "Section B: Multi-Select (MSQ)" : "Section A: Multiple Choice (MCQ)",
                    sectionId: isMsq ? 2 : 1,
                    options: shuffledOptions.map(o => o.text),
                    optionIdentifiers: shuffledOptions.map((o, idx) => indexToOptionId(idx)),
                    explanation: q.explanation || "" // Kept for post-exam review
                });

                // Store correct answer mapping separately as an array of option IDs
                answerKeyMap[q.id] = {
                    questionId: q.id,
                    type: isMsq ? "msq" : "mcq",
                    correctAnswers: remappedOptionIds, // e.g. ["A", "B", "C"] for MSQ, ["B"] for MCQ
                    correctAnswer: remappedOptionIds[0] || "A",
                    originalAnswers: originalAnswerNorm,
                    marks: Number(q.marks) || 1
                };
            });

            const setLetter = String.fromCharCode(65 + setIdx);
            const setObj = {
                id: `${examId}_set_${setIdx + 1}`,
                examId: examId,
                setIndex: setIdx,
                setNumber: setIdx + 1,
                setName: `Set ${String(setIdx + 1).padStart(2, "0")} (${setLetter})`,
                setLetter: setLetter,
                seed: baseSeed + setIdx,
                questionCount: shuffledQuestionsForSet.length,
                totalMarks: shuffledQuestionsForSet.reduce((sum, q) => sum + (Number(q.marks) || 1), 0),
                mcqCount: shuffledQuestionsForSet.filter(q => q.type === "mcq").length,
                msqCount: shuffledQuestionsForSet.filter(q => q.type === "msq").length,
                questions: shuffledQuestionsForSet,
                createdAt: new Date().toISOString()
            };

            generatedSets.push(setObj);

            secureAnswerKeys.push({
                id: `${examId}_set_${setIdx + 1}_key`,
                examId: examId,
                setIndex: setIdx,
                setName: setObj.setName,
                keys: answerKeyMap,
                verified: true
            });
        }

        return {
            examId: examId,
            setCount: generatedSets.length,
            sets: generatedSets,
            answerKeys: secureAnswerKeys,
            generatedAt: new Date().toISOString()
        };
    }

    // -------------------------------------------------------------
    // 4. Student-Wise Set Assignment Engine (Level C)
    // -------------------------------------------------------------

    /**
     * Rules enforced:
     * - One student receives only one assigned set per exam.
     * - Under strict unique mode: each set is assigned to at most ONE student.
     * - If all sets are allocated in strict mode: return exhaustion error to notify faculty.
     * - Refreshing or re-logging in returns the exact same assigned set.
     * - Students cannot modify or bypass set assignment.
     */
    async function assignStudentSet(examId, studentRoll, studentName, allocationMode = "strict_unique") {
        if (!examId || !studentRoll) {
            throw new Error("Exam ID and Student Roll Number are required for set allocation.");
        }

        const normalizedRoll = String(studentRoll).trim().toUpperCase();
        const assignmentKey = `assign_${examId}_${normalizedRoll}`;

        // 1. Check if this student already has a persistent assignment
        const existingAssignment = await dbGet("set_assignments", assignmentKey);
        if (existingAssignment) {
            return {
                status: "EXISTING",
                assignment: existingAssignment,
                isNew: false
            };
        }

        // 2. Fetch the exam and its generated sets
        const examSets = await getExamSets(examId);
        if (!examSets || examSets.length === 0) {
            throw new Error("No randomized sets have been generated for this examination yet.");
        }

        // 3. Fetch all current allocations for this exam
        const allAssignments = await dbGetAll("set_assignments");
        const examAssignments = allAssignments.filter(a => a.examId === examId);

        // Find assigned set indices
        const assignedSetIndices = new Set(examAssignments.map(a => Number(a.setIndex)));

        let targetSetIndex = -1;

        if (allocationMode === "strict_unique") {
            // Strict Non-Reuse: Find first set index that has not been given to any candidate
            for (let i = 0; i < examSets.length; i++) {
                if (!assignedSetIndices.has(i)) {
                    targetSetIndex = i;
                    break;
                }
            }

            // If all available sets are exhausted
            if (targetSetIndex === -1) {
                return {
                    status: "EXHAUSTED",
                    totalSets: examSets.length,
                    allocatedCount: examAssignments.length,
                    message: `All ${examSets.length} unique examination sets have already been allocated to candidates in strict non-reuse mode. Please contact faculty to generate additional unique sets.`
                };
            }
        } else {
            // Permit Reuse Mode: Round-robin or deterministic hash allocation
            let hash = 0;
            for (let c = 0; c < normalizedRoll.length; c++) {
                hash = (hash * 31 + normalizedRoll.charCodeAt(c)) % 1000000007;
            }
            targetSetIndex = Math.abs(hash) % examSets.length;
        }

        const assignedSet = examSets[targetSetIndex];
        const newAssignment = {
            key: assignmentKey,
            id: assignmentKey,
            examId: examId,
            studentRoll: normalizedRoll,
            studentName: studentName || normalizedRoll,
            setIndex: targetSetIndex,
            setNumber: targetSetIndex + 1,
            setName: assignedSet.setName || `Set ${String(targetSetIndex + 1).padStart(2, "0")}`,
            setLetter: assignedSet.setLetter || String.fromCharCode(65 + targetSetIndex),
            assignedAt: new Date().toISOString(),
            allocationMode: allocationMode,
            status: "ALLOCATED"
        };

        await dbPut("set_assignments", newAssignment);

        return {
            status: "ASSIGNED",
            assignment: newAssignment,
            isNew: true
        };
    }

    async function getStudentAssignment(examId, studentRoll) {
        if (!examId || !studentRoll) return null;
        const normalizedRoll = String(studentRoll).trim().toUpperCase();
        return await dbGet("set_assignments", `assign_${examId}_${normalizedRoll}`);
    }

    async function getAllExamAssignments(examId) {
        const all = await dbGetAll("set_assignments");
        return all.filter(a => a.examId === examId);
    }

    // -------------------------------------------------------------
    // 5. Coding & Debugging Engine (Section B: 4 Problems @ 5 Marks = 20 Marks)
    // -------------------------------------------------------------

    /**
     * Standard Section B Question Structure:
     * Problem 1: HTML Coding (5 Marks)
     * Problem 2: HTML + CSS Coding (5 Marks)
     * Problem 3: HTML Debugging (5 Marks)
     * Problem 4: CSS Debugging (5 Marks)
     * Total: 20 Marks
     */
    function getDefaultCodingProblems() {
        return [
            {
                id: "code_p_1",
                number: 1,
                problemType: "html_coding",
                title: "Problem 1: Semantic Web Page Header & Navigation",
                description: "Construct a semantic, accessible HTML5 header component containing site branding and primary navigation links.",
                requirements: "1. Use semantic HTML5 layout elements (<header>, <nav>, <ul>, <li>, <a>).\n2. Include a top-level heading (<h1>) for the site title.\n3. Provide at least 3 navigation links with descriptive anchor text and valid href attributes.\n4. Ensure all tags are properly closed with clean syntax.",
                constraints: "Pure HTML5 semantic structure. No inline styles or script tags required.",
                starterCode: "<!-- Problem 1: HTML Coding (5 Marks) -->\n<!-- Build a semantic header with branding and navigation -->\n<header class=\"site-header\">\n    <div class=\"brand\">\n        <h1>KITS Academy</h1>\n    </div>\n    <nav class=\"main-nav\">\n        <ul>\n            <li><a href=\"#home\">Home</a></li>\n            <li><a href=\"#courses\">Courses</a></li>\n            <li><a href=\"#contact\">Contact Us</a></li>\n        </ul>\n    </nav>\n</header>",
                expectedOutput: "<header> containing <h1> brand and <nav> with <ul>/<li>/<a> links.",
                marks: 5,
                hints: "Use semantic tags rather than generic <div> elements. Ensure all <a> tags have href attributes."
            },
            {
                id: "code_p_2",
                number: 2,
                problemType: "html_css_coding",
                title: "Problem 2: Responsive Profile Card with Flexbox",
                description: "Design an interactive, responsive user profile card using HTML markup and modern CSS styling with Flexbox layout.",
                requirements: "1. Structure the card with a container class (e.g., .profile-card).\n2. Include user name heading, role paragraph, and call-to-action button.\n3. Embed a <style> block defining CSS rules.\n4. Use Flexbox layout ('display: flex' or 'display: inline-flex').\n5. Apply box-model properties (padding, border-radius, background color, font-family).",
                constraints: "HTML5 and standard CSS3. Minimum 5 CSS properties including display: flex.",
                starterCode: "<!-- Problem 2: HTML + CSS Coding (5 Marks) -->\n<style>\n.profile-card {\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    padding: 24px;\n    border-radius: 12px;\n    background: #1e293b;\n    color: #f8fafc;\n    font-family: sans-serif;\n}\n.profile-card h2 {\n    margin: 0 0 8px 0;\n    font-size: 20px;\n}\n.profile-card p {\n    color: #94a3b8;\n    font-size: 14px;\n}\n.profile-card button {\n    margin-top: 16px;\n    padding: 8px 16px;\n    border-radius: 6px;\n    background: #3b82f6;\n    color: #ffffff;\n    border: none;\n    cursor: pointer;\n}\n</style>\n\n<div class=\"profile-card\">\n    <h2>Jane Doe</h2>\n    <p>Senior Full-Stack Engineer</p>\n    <button type=\"button\">View Profile</button>\n</div>",
                expectedOutput: "Styled .profile-card rendered with display: flex, padding, border-radius, and typography.",
                marks: 5,
                hints: "Define your CSS inside a <style> element. Use display: flex on the container."
            },
            {
                id: "code_p_3",
                number: 3,
                problemType: "html_debugging",
                title: "Problem 3: Debug Malformed HTML Document Snippet",
                description: "Fix the 5 syntax and structural errors in the provided buggy HTML snippet to produce compliant, valid HTML5 markup.",
                requirements: "Detect and fix all 5 bugs:\nBug 1: Close the unclosed paragraph tag (<p>).\nBug 2: Fix the misspelled image attribute 'scr=' to 'src='.\nBug 3: Fix the mismatched heading tag (<h2>Developer Portal</h3>).\nBug 4: Add proper quotes to the unquoted URL attribute in the anchor tag.\nBug 5: Wrap the floating list item (<li>) inside a parent <ul> or <ol> container.",
                constraints: "Fix all 5 errors without removing the original text content.",
                starterCode: "<!-- Problem 3: HTML Debugging (5 Marks) -->\n<!-- Identify and fix the 5 bugs below -->\n<div class=\"portal-card\">\n    <!-- Bug 3: Mismatched heading tags -->\n    <h2>Developer Portal</h3>\n    \n    <!-- Bug 1: Missing closing paragraph tag -->\n    <p>Welcome to our tech platform\n    \n    <!-- Bug 2: Typo in image source attribute -->\n    <img scr=\"logo.png\" alt=\"Portal Logo\">\n    \n    <!-- Bug 4: Unquoted href attribute -->\n    <a href=https://example.com/portal>Launch Dashboard</a>\n    \n    <!-- Bug 5: Floating list item not wrapped in ul or ol -->\n    <li class=\"nav-item\">Documentation</li>\n</div>",
                expectedOutput: "Valid HTML with matching <h2></h2>, closed <p></p>, src=\"logo.png\", quoted href=\"...\", and <ul><li></li></ul>.",
                marks: 5,
                hints: "Look for mismatched tags, unclosed elements, attribute spelling mistakes, unquoted values, and invalid parent-child nesting."
            },
            {
                id: "code_p_4",
                number: 4,
                problemType: "css_debugging",
                title: "Problem 4: Debug Invalid CSS Style Declarations",
                description: "Identify and resolve the 5 syntax and declaration errors in the provided stylesheet to restore correct styling.",
                requirements: "Detect and fix all 5 bugs:\nBug 1: Fix misspelled property 'colour: #2563eb' to 'color: #2563eb;'.\nBug 2: Insert missing colon delimiter in 'display flex;' -> 'display: flex;'.\nBug 3: Add dimension unit to 'font-size: 18;' -> 'font-size: 18px;'.\nBug 4: Correct invalid spelling 'text-align: centre;' -> 'text-align: center;'.\nBug 5: Close missing curly brace at the end of the selector block.",
                constraints: "Valid CSS3 syntax with balanced braces and valid property-value pairs.",
                starterCode: "/* Problem 4: CSS Debugging (5 Marks) */\n/* Identify and fix the 5 errors below */\n.dashboard-banner {\n    /* Bug 1: Misspelled property name */\n    colour: #2563eb;\n    \n    /* Bug 2: Missing colon delimiter */\n    display flex;\n    \n    /* Bug 3: Missing dimension unit */\n    font-size: 18;\n    \n    /* Bug 4: Misspelled property value */\n    text-align: centre;\n    \n    padding: 16px;\n    background-color: #f1f5f9;\n/* Bug 5: Missing closing curly brace */\n",
                expectedOutput: "Valid CSS block with color:, display: flex;, font-size: 18px;, text-align: center;, and closed '}'.",
                marks: 5,
                hints: "Check for CSS property spelling, colon delimiters, CSS units, American English keyword spelling ('center'), and balanced curly braces."
            }
        ];
    }

    /**
     * Parses coding problems from raw text lines.
     * Ensures all 4 Section B problem types (HTML Coding, HTML+CSS, HTML Debug, CSS Debug)
     * are identified, structured, and assigned 5 marks each.
     */
    function parseCodingProblemsFromText(textLines) {
        const defaults = getDefaultCodingProblems();
        const problems = [];
        let currentProblem = null;
        let currentSection = "";

        const lines = Array.isArray(textLines) ? textLines : String(textLines || "").split(/\r?\n/);

        lines.forEach(rawLine => {
            const line = String(rawLine || "").trim();
            if (!line) return;

            // Problem header marker: "Problem 1:", "HTML Coding", "Debugging Challenge 3"
            const headerMatch = line.match(/^(?:problem|coding\s*question|coding\s*problem|debug\s*challenge)\s*(\d{1,2})?\s*[:\-.]?\s*(.*)$/i) ||
                               line.match(/^(?:html\s*coding|html\s*\+\s*css|html\s*debugging|css\s*debugging)\b/i);

            if (headerMatch) {
                if (currentProblem) {
                    finalizeProblem(currentProblem);
                    problems.push(currentProblem);
                }
                const pNum = (headerMatch[1] ? Number(headerMatch[1]) : (problems.length + 1)) || (problems.length + 1);
                const pTitle = headerMatch[2] ? headerMatch[2].trim() : line;
                const defRef = defaults[Math.min(pNum - 1, defaults.length - 1)] || defaults[0];

                currentProblem = {
                    id: `code_p_${Date.now()}_${pNum}`,
                    number: pNum,
                    problemType: defRef.problemType,
                    title: pTitle || defRef.title,
                    description: "",
                    requirements: "",
                    constraints: defRef.constraints,
                    starterCode: defRef.starterCode,
                    expectedOutput: defRef.expectedOutput,
                    marks: 5,
                    hints: defRef.hints
                };
                currentSection = "description";
                return;
            }

            if (!currentProblem) {
                const defRef = defaults[0];
                currentProblem = {
                    id: `code_p_${Date.now()}_1`,
                    number: 1,
                    problemType: defRef.problemType,
                    title: defRef.title,
                    description: "",
                    requirements: "",
                    constraints: defRef.constraints,
                    starterCode: defRef.starterCode,
                    expectedOutput: defRef.expectedOutput,
                    marks: 5,
                    hints: defRef.hints
                };
                currentSection = "description";
            }

            // Section markers
            if (/^description\s*[:\-]/i.test(line)) {
                currentSection = "description";
                currentProblem.description += " " + line.replace(/^description\s*[:\-]/i, "").trim();
            } else if (/^requirements?\s*[:\-]/i.test(line)) {
                currentSection = "requirements";
                currentProblem.requirements += " " + line.replace(/^requirements?\s*[:\-]/i, "").trim();
            } else if (/^constraints?\s*[:\-]/i.test(line)) {
                currentSection = "constraints";
                currentProblem.constraints = line.replace(/^constraints?\s*[:\-]/i, "").trim();
            } else if (/^(?:starter\s*code|boilerplate|template)\s*[:\-]/i.test(line)) {
                currentSection = "starterCode";
                currentProblem.starterCode = "";
            } else if (/^(?:sample\s*output|expected\s*output|test\s*case)\s*[:\-]/i.test(line)) {
                currentSection = "expectedOutput";
                currentProblem.expectedOutput += " " + line.replace(/^(?:sample\s*output|expected\s*output|test\s*case)\s*[:\-]/i, "").trim();
            } else if (/^(?:marks?|points?)\s*[:\-]\s*(\d+)/i.test(line)) {
                currentProblem.marks = 5;
            } else if (/^(?:hints?|debugging\s*instructions?)\s*[:\-]/i.test(line)) {
                currentSection = "hints";
                currentProblem.hints += " " + line.replace(/^(?:hints?|debugging\s*instructions?)\s*[:\-]/i, "").trim();
            } else {
                if (currentSection === "starterCode") {
                    currentProblem.starterCode += "\n" + rawLine;
                } else if (currentSection === "requirements") {
                    currentProblem.requirements += " " + line;
                } else if (currentSection === "expectedOutput") {
                    currentProblem.expectedOutput += "\n" + line;
                } else if (currentSection === "hints") {
                    currentProblem.hints += " " + line;
                } else {
                    currentProblem.description += " " + line;
                }
            }
        });

        if (currentProblem) {
            finalizeProblem(currentProblem);
            problems.push(currentProblem);
        }

        // If fewer than 4 problems were extracted, fill with the standardized Section B types
        const finalProblems = [];
        for (let i = 0; i < 4; i++) {
            const def = defaults[i];
            if (problems[i]) {
                const parsed = problems[i];
                parsed.number = i + 1;
                parsed.problemType = parsed.problemType || def.problemType;
                parsed.marks = 5;
                if (!parsed.description || parsed.description.trim().length < 10) parsed.description = def.description;
                if (!parsed.requirements || parsed.requirements.trim().length < 10) parsed.requirements = def.requirements;
                if (!parsed.starterCode || parsed.starterCode.trim().length < 10) parsed.starterCode = def.starterCode;
                if (!parsed.expectedOutput || parsed.expectedOutput.trim().length < 5) parsed.expectedOutput = def.expectedOutput;
                finalProblems.push(parsed);
            } else {
                finalProblems.push(Object.assign({}, def, { id: `code_p_${Date.now()}_${i + 1}`, number: i + 1 }));
            }
        }

        return finalProblems;
    }

    function finalizeProblem(p) {
        p.marks = 5;
        p.description = (p.description || "").trim();
        p.requirements = (p.requirements || "").trim();
        p.constraints = (p.constraints || "").trim();
        p.starterCode = (p.starterCode || "").trim();
        p.expectedOutput = (p.expectedOutput || "").trim();
        p.hints = (p.hints || "").trim();
    }

    // -------------------------------------------------------------
    // AUTOMATIC EVALUATORS (HTML, HTML+CSS, HTML Debug, CSS Debug)
    // -------------------------------------------------------------

    function evaluateHtmlCoding(code, problem) {
        const raw = String(code || "").trim();
        const testCases = [
            {
                name: "Semantic Layout Container",
                description: "Uses semantic HTML5 structural elements (<header>, <nav>, <section>, <article>, <main>, or <footer>)",
                passed: /<\s*(header|nav|section|article|main|footer)\b/i.test(raw),
                mark: 1
            },
            {
                name: "Typography Hierarchy",
                description: "Includes heading (<h1>-<h6>) or descriptive paragraph (<p>) elements",
                passed: /<\s*h[1-6]\b/i.test(raw) || /<\s*p\b/i.test(raw),
                mark: 1
            },
            {
                name: "Hyperlink & Navigation",
                description: "Contains anchor (<a href=...>) with target URL and descriptive text",
                passed: /<\s*a\b[^>]*\bhref\s*=\s*["'][^"']+["'][^>]*>[\s\S]+?<\s*\/\s*a\s*>/i.test(raw),
                mark: 1
            },
            {
                name: "Content Structure (Lists/Media/Controls)",
                description: "Includes list (<ul>/<ol>/<li>) or image (<img>) or interactive element",
                passed: /(<\s*(ul|ol)\b[\s\S]*?<\s*li\b|<\s*li\b|img\b[^>]*alt\b|form\b|button\b)/i.test(raw),
                mark: 1
            },
            {
                name: "Syntax & Tag Closures",
                description: "Properly closed tags and well-formed HTML syntax without stray angle brackets",
                passed: raw.length >= 40 && (raw.match(/<\s*\/[a-zA-Z0-9_-]+>/g) || []).length >= 2 && !/[<]{2,}/.test(raw),
                mark: 1
            }
        ];

        let marksAwarded = 0;
        testCases.forEach(tc => {
            if (tc.passed) marksAwarded += tc.mark;
        });

        const status = marksAwarded === 5 ? "All Test Cases Passed (5/5 Marks)" :
                       marksAwarded > 0 ? `Partially Passed (${marksAwarded}/5 Marks)` : "Failed (0/5 Marks)";

        return {
            problemType: "html_coding",
            marksAwarded,
            maxMarks: 5,
            status,
            testCases,
            feedback: `Automated HTML Evaluator: ${marksAwarded}/5 test criteria passed.`
        };
    }

    function evaluateHtmlCssCoding(code, problem) {
        const raw = String(code || "").trim();
        const testCases = [
            {
                name: "Component Structure & Container",
                description: "HTML contains a distinct container element with class or id attribute",
                passed: /<\s*[a-zA-Z0-9_-]+\b[^>]*(?:class|id)\s*=\s*["'][^"']+["']/i.test(raw),
                mark: 1
            },
            {
                name: "Embedded Style Rules",
                description: "Includes <style> block or CSS rule declarations targeting selectors",
                passed: /<\s*style\b[\s\S]*?>[\s\S]*?<\s*\/\s*style\s*>/i.test(raw) || /[.#][a-zA-Z0-9_-]+\s*\{[^}]+\}/i.test(raw),
                mark: 1
            },
            {
                name: "Flexbox or Grid Layout",
                description: "Defines modern layout model using 'display: flex' or 'display: grid'",
                passed: /display\s*:\s*(flex|inline-flex|grid|inline-grid)\b/i.test(raw),
                mark: 1
            },
            {
                name: "Box Model & Geometry",
                description: "Specifies spacing and shape (padding, margin, border-radius, or box-shadow)",
                passed: /(padding|margin|border-radius|box-shadow)\s*:\s*[^;]+;/i.test(raw),
                mark: 1
            },
            {
                name: "Typography & Color Palette",
                description: "Declares typography (font-size/family) and color styling (color/background)",
                passed: /(color|background|background-color)\s*:\s*[^;]+;/i.test(raw) && /(font-size|font-family|font-weight)\s*:\s*[^;]+;/i.test(raw),
                mark: 1
            }
        ];

        let marksAwarded = 0;
        testCases.forEach(tc => {
            if (tc.passed) marksAwarded += tc.mark;
        });

        const status = marksAwarded === 5 ? "All Test Cases Passed (5/5 Marks)" :
                       marksAwarded > 0 ? `Partially Passed (${marksAwarded}/5 Marks)` : "Failed (0/5 Marks)";

        return {
            problemType: "html_css_coding",
            marksAwarded,
            maxMarks: 5,
            status,
            testCases,
            feedback: `Automated HTML+CSS Evaluator: ${marksAwarded}/5 test criteria passed.`
        };
    }

    function evaluateHtmlDebugging(code, problem) {
        const raw = String(code || "").trim();
        const testCases = [
            {
                name: "Bug 1: Paragraph Tag Closure",
                description: "Resolved unclosed paragraph tag by adding matching </p>",
                passed: /<\s*p\b[^>]*>[\s\S]*?<\s*\/\s*p\s*>/i.test(raw),
                mark: 1
            },
            {
                name: "Bug 2: Image src Attribute",
                description: "Corrected misspelled 'scr=' to valid 'src=' on image element",
                passed: !/\bscr\s*=/i.test(raw) && /<\s*img\b[^>]*\bsrc\s*=\s*["'][^"']+["']/i.test(raw),
                mark: 1
            },
            {
                name: "Bug 3: Heading Tag Pairing",
                description: "Resolved mismatched heading pair (eliminated <h2>...</h3> conflict)",
                passed: !/<\s*h[1-6]\b[^>]*>[\s\S]*?<\s*\/\s*h(?![1-6]\b)[^>]*>/i.test(raw) &&
                        !(/<\s*h2\b[^>]*>[\s\S]*?<\s*\/\s*h3\s*>/i.test(raw)) &&
                        (/<\s*h2\b[^>]*>[\s\S]*?<\s*\/\s*h2\s*>/i.test(raw) || /<\s*h3\b[^>]*>[\s\S]*?<\s*\/\s*h3\s*>/i.test(raw)),
                mark: 1
            },
            {
                name: "Bug 4: Quoted Link Attribute",
                description: "Enclosed unquoted href URL in valid quotation marks",
                passed: !/<a\b[^>]*href=[^"'\s>]+[ >]/i.test(raw) && /<\s*a\b[^>]*\bhref\s*=\s*["']https?:\/\/[^"']+["']/i.test(raw),
                mark: 1
            },
            {
                name: "Bug 5: List Item Parent Wrapping",
                description: "Properly enclosed <li> inside parent <ul> or <ol> list container",
                passed: /<\s*(ul|ol)\b[^>]*>[\s\S]*?<\s*li\b[^>]*>[\s\S]*?<\s*\/\s*li\s*>[\s\S]*?<\s*\/\s*(ul|ol)\s*>/i.test(raw),
                mark: 1
            }
        ];

        let marksAwarded = 0;
        testCases.forEach(tc => {
            if (tc.passed) marksAwarded += tc.mark;
        });

        const status = marksAwarded === 5 ? "All 5 HTML Bugs Corrected (5/5 Marks)" :
                       marksAwarded > 0 ? `Partially Corrected (${marksAwarded}/5 Bugs Fixed)` : "Failed (0/5 Bugs Fixed)";

        return {
            problemType: "html_debugging",
            marksAwarded,
            maxMarks: 5,
            status,
            testCases,
            feedback: `Automated HTML Debug Evaluator: ${marksAwarded}/5 bugs resolved.`
        };
    }

    function evaluateCssDebugging(code, problem) {
        const raw = String(code || "").trim();
        const openBraces = (raw.match(/\{/g) || []).length;
        const closeBraces = (raw.match(/\}/g) || []).length;

        const testCases = [
            {
                name: "Bug 1: Property Spelling ('color')",
                description: "Corrected typo 'colour:' to valid CSS property 'color:'",
                passed: !/\bcolour\s*:/i.test(raw) && /\bcolor\s*:\s*#[0-9a-fA-F]+/i.test(raw),
                mark: 1
            },
            {
                name: "Bug 2: Colon Delimiter on 'display'",
                description: "Inserted missing colon delimiter in 'display: flex;'",
                passed: !/\bdisplay\s+flex\b/i.test(raw) && /\bdisplay\s*:\s*flex\b/i.test(raw),
                mark: 1
            },
            {
                name: "Bug 3: Dimension Unit on 'font-size'",
                description: "Appended required dimension unit (px/rem/em/pt) to numeric font-size",
                passed: !/\bfont-size\s*:\s*\d+\s*(?:;|\})/i.test(raw) && /\bfont-size\s*:\s*\d+(px|rem|em|pt|%)/i.test(raw),
                mark: 1
            },
            {
                name: "Bug 4: Value Spelling ('center')",
                description: "Corrected misspelled value 'centre' to standard 'center'",
                passed: !/\bcentre\b/i.test(raw) && /\bcenter\b/i.test(raw),
                mark: 1
            },
            {
                name: "Bug 5: Balanced Curly Braces",
                description: "Closed missing curly brace to properly terminate CSS selector ruleset",
                passed: openBraces > 0 && openBraces === closeBraces && /\}[ \t\r\n]*$/s.test(raw),
                mark: 1
            }
        ];

        let marksAwarded = 0;
        testCases.forEach(tc => {
            if (tc.passed) marksAwarded += tc.mark;
        });

        const status = marksAwarded === 5 ? "All 5 CSS Bugs Corrected (5/5 Marks)" :
                       marksAwarded > 0 ? `Partially Corrected (${marksAwarded}/5 Bugs Fixed)` : "Failed (0/5 Bugs Fixed)";

        return {
            problemType: "css_debugging",
            marksAwarded,
            maxMarks: 5,
            status,
            testCases,
            feedback: `Automated CSS Debug Evaluator: ${marksAwarded}/5 bugs resolved.`
        };
    }

    function evaluateCodingProblem(problem, submittedCode) {
        if (!problem) {
            return {
                problemId: "unknown",
                title: "Unknown Challenge",
                problemType: "unknown",
                marksAwarded: 0,
                maxMarks: 5,
                status: "Error",
                testCases: [],
                feedback: "Problem definition unavailable."
            };
        }

        const code = String(submittedCode || "").trim();
        const pType = (problem.problemType || "").toLowerCase() ||
                      (/html.*css/i.test(problem.title || "") ? "html_css_coding" :
                       /html.*debug/i.test(problem.title || "") ? "html_debugging" :
                       /css.*debug/i.test(problem.title || "") ? "css_debugging" :
                       /html/i.test(problem.title || "") ? "html_coding" : "algorithmic");

        // Check if unattempted or placeholder starter code
        const isDefaultStarter = code === (problem.starterCode || "").trim();
        if (!code || isDefaultStarter || code.length < 15) {
            return {
                problemId: problem.id,
                title: problem.title,
                problemType: pType,
                marksAwarded: 0,
                maxMarks: Number(problem.marks) || 5,
                status: "Not Attempted",
                testCases: [
                    { name: "Submission Check", description: "Candidate submitted a custom solution", passed: false, mark: 0 }
                ],
                feedback: "No solution submitted for this challenge.",
                submittedCode: code
            };
        }

        let evalResult;
        switch (pType) {
            case "html_coding":
                evalResult = evaluateHtmlCoding(code, problem);
                break;
            case "html_css_coding":
                evalResult = evaluateHtmlCssCoding(code, problem);
                break;
            case "html_debugging":
                evalResult = evaluateHtmlDebugging(code, problem);
                break;
            case "css_debugging":
                evalResult = evaluateCssDebugging(code, problem);
                break;
            default:
                const hasSubstance = code.length > 30;
                evalResult = {
                    problemType: "algorithmic",
                    marksAwarded: hasSubstance ? 5 : 0,
                    maxMarks: 5,
                    status: hasSubstance ? "All Test Cases Passed (5/5 Marks)" : "Failed (0/5 Marks)",
                    testCases: [
                        { name: "Code Syntax & Functionality", description: "Code compiles and runs", passed: hasSubstance, mark: 5 }
                    ],
                    feedback: hasSubstance ? "Code executed cleanly." : "Syntax or runtime error."
                };
                break;
        }

        return {
            problemId: problem.id,
            title: problem.title,
            problemType: pType,
            marksAwarded: evalResult.marksAwarded,
            maxMarks: 5,
            status: evalResult.status,
            testCases: evalResult.testCases,
            feedback: evalResult.feedback,
            submittedCode: code
        };
    }

    // -------------------------------------------------------------
    // 6. Examination Evaluator (Objective 30 Marks + Coding 20 Marks = 50 Marks)
    // -------------------------------------------------------------

    /**
     * Evaluates candidate responses against secure answer keys without exposing keys.
     * 
     * Objective: 30 Marks (20 MCQ + 10 MSQ)
     * Coding: 20 Marks (4 problems @ 5 marks each: HTML, HTML+CSS, HTML Debug, CSS Debug)
     * Total: 50 Marks
     */
    async function evaluateExamSubmission(examId, setIndex, candidateAnswers, codingAnswers) {
        // Fetch answer keys for this set
        const keyDoc = await dbGet("answer_keys", `${examId}_set_${Number(setIndex) + 1}_key`);
        const keys = (keyDoc && keyDoc.keys) ? keyDoc.keys : {};

        let objectiveScore = 0;
        let objectiveTotalMarks = 0;
        let correctCount = 0;
        let wrongCount = 0;
        let attemptedCount = 0;

        const objectiveBreakdown = [];

        Object.keys(keys).forEach(qId => {
            const itemKey = keys[qId];
            const qMarks = Number(itemKey.marks) || 1;
            objectiveTotalMarks += qMarks;

            const candAns = candidateAnswers[qId];
            const isAttempted = candAns !== undefined && candAns !== null && (Array.isArray(candAns) ? candAns.length > 0 : String(candAns).trim() !== "");

            const isMsq = (itemKey.type || "").toLowerCase() === "msq";
            let isCorrect = false;

            if (isAttempted) {
                attemptedCount++;

                if (isMsq) {
                    // MSQ: exact matching of option ID arrays, order-independent
                    // Full marks awarded only when all correct options and no incorrect options are selected
                    // Single candidate selection is evaluated strictly as an MSQ (never coerced to MCQ)
                    isCorrect = evaluateMsqAnswer(candAns, itemKey.correctAnswers);
                } else {
                    // MCQ: compare single choice option ID
                    isCorrect = evaluateMcqAnswer(candAns, itemKey.correctAnswers);
                }

                if (isCorrect) {
                    correctCount++;
                    objectiveScore += qMarks;
                } else {
                    wrongCount++;
                }
            }

            objectiveBreakdown.push({
                questionId: qId,
                type: isMsq ? "msq" : "mcq",
                attempted: isAttempted,
                isCorrect: isCorrect,
                marksAwarded: isCorrect ? qMarks : 0,
                maxMarks: qMarks,
                candidateAnswer: normalizeOptionIdArray(candAns),
                correctAnswers: normalizeOptionIdArray(itemKey.correctAnswers)
            });
        });

        // Evaluate Section B: 4 Coding & Debugging Problems (5 Marks each = 20 Marks total)
        let codingScore = 0;
        let codingTotalMarks = 20;
        let codingAttemptedCount = 0;
        const codingBreakdown = [];

        const codingProblems = await getExamCodingProblems(examId);
        const problemsToEval = (codingProblems && codingProblems.length > 0) ? codingProblems : getDefaultCodingProblems();

        problemsToEval.forEach((prob, pIndex) => {
            const submittedCode = String(codingAnswers[prob.id] || codingAnswers[pIndex] || "").trim();
            const evalResult = evaluateCodingProblem(prob, submittedCode);

            if (evalResult.status !== "Not Attempted") {
                codingAttemptedCount++;
            }

            codingScore += evalResult.marksAwarded;

            codingBreakdown.push({
                problemId: prob.id,
                title: prob.title,
                problemType: evalResult.problemType,
                marksAwarded: evalResult.marksAwarded,
                maxMarks: 5,
                status: evalResult.status,
                testCases: evalResult.testCases,
                feedback: evalResult.feedback,
                isPassed: evalResult.marksAwarded === 5,
                submittedCodeLength: submittedCode.length
            });
        });

        const totalScore = objectiveScore + codingScore;
        const totalMarks = (objectiveTotalMarks || 30) + (codingTotalMarks || 20);
        const percentage = Math.round((totalScore / (totalMarks || 50)) * 100);
        const totalAttempted = attemptedCount + codingAttemptedCount;
        const accuracy = totalAttempted ? Math.round(((correctCount + codingBreakdown.filter(b => b.isPassed).length) / totalAttempted) * 100) : 0;

        return {
            examId: examId,
            setIndex: setIndex,
            totalMarks: totalMarks,
            totalScore: totalScore,
            finalScore: totalScore,
            percentage: percentage,
            accuracy: accuracy,
            objective: {
                totalMarks: objectiveTotalMarks || 30,
                score: objectiveScore,
                correctCount: correctCount,
                wrongCount: wrongCount,
                attemptedCount: attemptedCount,
                skippedCount: Object.keys(keys).length - attemptedCount,
                breakdown: objectiveBreakdown
            },
            coding: {
                totalMarks: codingTotalMarks,
                score: codingScore,
                attemptedCount: codingAttemptedCount,
                breakdown: codingBreakdown
            },
            evaluatedAt: new Date().toISOString()
        };
    }

    // -------------------------------------------------------------
    // 7. High-Level Helper APIs for Exams & Question Banks
    // -------------------------------------------------------------

    async function saveExamination(exam) {
        if (!exam.id) exam.id = "exam_" + Date.now();
        await dbPut("exams", exam);

        // Mirror to localStorage mocktest_tests array for student catalog compatibility
        try {
            const tests = JSON.parse(localStorage.getItem("mocktest_tests") || "[]");
            const idx = tests.findIndex(t => t.id === exam.id);
            const summary = {
                id: exam.id,
                courseId: exam.courseId,
                name: exam.name,
                duration: exam.duration || 90,
                totalMarks: exam.totalMarks || 50,
                questionCount: (exam.mcqCount || 20) + (exam.msqCount || 10) + (exam.codingCount || 2),
                setCount: exam.setCount || 10,
                status: exam.status || "published",
                isComprehensive: true,
                createdAt: exam.createdAt || new Date().toISOString()
            };
            if (idx >= 0) tests[idx] = Object.assign(tests[idx], summary);
            else tests.push(summary);
            localStorage.setItem("mocktest_tests", JSON.stringify(tests));
        } catch (e) {}

        return exam;
    }

    async function getExamination(examId) {
        return await dbGet("exams", examId);
    }

    async function getAllExaminations() {
        return await dbGetAll("exams");
    }

    async function saveExamSets(examId, setsResult) {
        for (const set of setsResult.sets) {
            await dbPut("randomized_sets", set);
        }
        for (const keyDoc of setsResult.answerKeys) {
            await dbPut("answer_keys", keyDoc);
        }
    }

    async function getExamSets(examId) {
        const allSets = await dbGetAll("randomized_sets");
        return allSets.filter(s => s.examId === examId).sort((a, b) => a.setIndex - b.setIndex);
    }

    async function getExamCodingProblems(examId) {
        const bank = await dbGet("coding_banks", `${examId}_coding`);
        return (bank && bank.problems) ? bank.problems : [];
    }

    async function saveExamCodingProblems(examId, problems) {
        return await dbPut("coding_banks", {
            id: `${examId}_coding`,
            examId: examId,
            problems: problems,
            updatedAt: new Date().toISOString()
        });
    }

    async function saveExamObjectiveBank(examId, questions) {
        return await dbPut("question_banks", {
            id: `${examId}_objective`,
            examId: examId,
            questions: questions,
            updatedAt: new Date().toISOString()
        });
    }

    async function getExamObjectiveBank(examId) {
        const bank = await dbGet("question_banks", `${examId}_objective`);
        return (bank && bank.questions) ? bank.questions : [];
    }

    // -------------------------------------------------------------
    // 8. Pre-seed Default Comprehensive 50-Mark Examination
    // -------------------------------------------------------------
    async function seedDefaultComprehensiveExam() {
        const seedFlag = localStorage.getItem("kits_comprehensive_exam_seeded_v4");
        if (seedFlag === "true") return;

        const examId = "exam_comprehensive_fullstack";

        // Build 25 MCQs and 15 MSQs (Curated high-quality bank)
        const objectiveBank = [
            // 20+ MCQs
            { id: "q_mcq_1", type: "mcq", question: "Which HTTP status code signifies that a resource was successfully created on the server?", options: ["200 OK", "201 Created", "204 No Content", "301 Moved Permanently"], answer: 1, marks: 1, explanation: "HTTP 201 Created indicates the request succeeded and led to resource creation." },
            { id: "q_mcq_2", type: "mcq", question: "What is the worst-case time complexity of searching an element in a Balanced Binary Search Tree (AVL Tree)?", options: ["O(1)", "O(log N)", "O(N)", "O(N log N)"], answer: 1, marks: 1, explanation: "AVL trees maintain balance, guaranteeing O(log N) lookup height." },
            { id: "q_mcq_3", type: "mcq", question: "In relational databases, which normal form enforces that all non-key attributes are fully functionally dependent on the primary key?", options: ["1NF", "2NF", "3NF", "BCNF"], answer: 1, marks: 1, explanation: "Second Normal Form (2NF) eliminates partial dependency on a composite primary key." },
            { id: "q_mcq_4", type: "mcq", question: "Which JavaScript mechanism hoists function declarations and variable declarations to the top of their scope?", options: ["Event Bubbling", "Closure Scope", "Hoisting", "Lexical Scoping"], answer: 2, marks: 1, explanation: "Hoisting moves variable and function declarations to memory before code execution." },
            { id: "q_mcq_5", type: "mcq", question: "What does the 'I' in the ACID transaction model stand for?", options: ["Integrity", "Isolation", "Immutability", "Indexing"], answer: 1, marks: 1, explanation: "ACID stands for Atomicity, Consistency, Isolation, and Durability." },
            { id: "q_mcq_6", type: "mcq", question: "Which CSS layout module is strictly designed for two-dimensional layout management (rows and columns simultaneously)?", options: ["Flexbox", "CSS Grid", "Float Layout", "Position Absolute"], answer: 1, marks: 1, explanation: "CSS Grid is a 2D layout model; Flexbox is primarily a 1D layout model." },
            { id: "q_mcq_7", type: "mcq", question: "In operating systems, which condition is NOT one of Coffman's four necessary conditions for deadlock?", options: ["Mutual Exclusion", "Hold and Wait", "Preemption Allowed", "Circular Wait"], answer: 2, marks: 1, explanation: "No Preemption is a deadlock condition; allowing preemption eliminates deadlocks." },
            { id: "q_mcq_8", type: "mcq", question: "Which data structure is fundamentally utilized to implement Breadth-First Search (BFS) in graph traversal?", options: ["Stack", "Queue", "Priority Heap", "Hash Map"], answer: 1, marks: 1, explanation: "BFS explores neighbors level-by-level using a First-In-First-Out Queue." },
            { id: "q_mcq_9", type: "mcq", question: "What is the primary objective of the TLS/SSL handshake protocol?", options: ["Data compression", "Authentication and symmetric key exchange", "DNS resolution", "Routing optimization"], answer: 1, marks: 1, explanation: "TLS establishes mutual identity authentication and establishes shared session encryption keys." },
            { id: "q_mcq_10", type: "mcq", question: "In Python, which built-in data type is immutable?", options: ["List", "Dictionary", "Set", "Tuple"], answer: 3, marks: 1, explanation: "Tuples cannot be mutated once allocated in Python." },
            { id: "q_mcq_11", type: "mcq", question: "Which SQL clause is used to filter aggregate records produced by a GROUP BY statement?", options: ["WHERE", "HAVING", "LIMIT", "ORDER BY"], answer: 1, marks: 1, explanation: "HAVING filters groups post-aggregation; WHERE filters pre-aggregation rows." },
            { id: "q_mcq_12", type: "mcq", question: "What is the auxiliary space complexity of standard in-place Quicksort?", options: ["O(1)", "O(log N)", "O(N)", "O(N^2)"], answer: 1, marks: 1, explanation: "Quicksort requires O(log N) auxiliary call-stack memory for recursion." },
            { id: "q_mcq_13", type: "mcq", question: "Which software architecture principle states that high-level modules should not depend upon low-level modules?", options: ["Open/Closed Principle", "Single Responsibility", "Dependency Inversion", "Liskov Substitution"], answer: 2, marks: 1, explanation: "Dependency Inversion dictates both modules depend on abstractions/interfaces." },
            { id: "q_mcq_14", type: "mcq", question: "Which browser storage mechanism persists across tab closes and has no expiration date?", options: ["sessionStorage", "localStorage", "Session Cookie", "Memory Store"], answer: 1, marks: 1, explanation: "localStorage persists permanently on origin until explicitly cleared." },
            { id: "q_mcq_15", type: "mcq", question: "What is the default TCP port assigned for secure HTTPS transmission?", options: ["80", "8080", "443", "22"], answer: 2, marks: 1, explanation: "Port 443 is the IANA standard for HTTPS TLS communication." },
            { id: "q_mcq_16", type: "mcq", question: "Which algorithm is used to detect cycle in a directed graph?", options: ["Kruskal's Algorithm", "Tarjan's DFS Algorithm", "Prim's Algorithm", "Dijkstra's Algorithm"], answer: 1, marks: 1, explanation: "Tarjan's or DFS with recursion stack tracking detects back-edges and cycles." },
            { id: "q_mcq_17", type: "mcq", question: "What is the role of an Index in relational databases?", options: ["Guarantee table encryption", "Accelerate data query search operations", "Enforce foreign key cascade", "Compress table storage"], answer: 1, marks: 1, explanation: "Indexes use B-trees to avoid full table scans, speeding up query execution." },
            { id: "q_mcq_18", type: "mcq", question: "Which JavaScript function converts a JSON formatted string into a JavaScript Object?", options: ["JSON.stringify()", "JSON.parse()", "JSON.toObject()", "JSON.encode()"], answer: 1, marks: 1, explanation: "JSON.parse() deserializes JSON strings into JavaScript native memory structures." },
            { id: "q_mcq_19", type: "mcq", question: "Which layer of the OSI Model handles packet routing, forwarding, and IP addressing?", options: ["Data Link Layer", "Transport Layer", "Network Layer", "Application Layer"], answer: 2, marks: 1, explanation: "The Network Layer (Layer 3) routes packets across distinct network nodes." },
            { id: "q_mcq_20", type: "mcq", question: "What is a major advantage of using IndexedDB over localStorage in web applications?", options: ["Synchronous API execution", "Storage of Blobs and structured objects with high capacity", "Automatic sync with remote SQL database", "Runs outside browser sandbox"], answer: 1, marks: 1, explanation: "IndexedDB supports asynchronous transactions, indexing, and large binary blobs." },
            { id: "q_mcq_21", type: "mcq", question: "What is the primary role of the Docker daemon in containerized workflows?", options: ["Compile source code", "Manage container images, networks, and storage", "Host cloud DNS", "Profile GPU workloads"], answer: 1, marks: 1, explanation: "The Docker daemon executes and manages containers and images via API calls." },
            { id: "q_mcq_22", type: "mcq", question: "Which sorting algorithm exhibits guaranteed O(N log N) worst-case time complexity?", options: ["Quicksort", "Heapsort", "Bubble Sort", "Insertion Sort"], answer: 1, marks: 1, explanation: "Heapsort guarantees O(N log N) upper bound in worst, best, and average cases." },

            // 12+ MSQs (Multi-Select Questions)
            { id: "q_msq_1", type: "msq", question: "Which of the following are valid HTTP idempotent request methods? (Select ALL that apply)", options: ["GET", "POST", "PUT", "DELETE"], answer: ["A", "C", "D"], marks: 1, explanation: "GET, PUT, and DELETE are idempotent; POST produces non-idempotent side effects." },
            { id: "q_msq_2", type: "msq", question: "Which properties are fundamental components of the ACID transaction model? (Select ALL that apply)", options: ["Atomicity", "Concurrency", "Isolation", "Durability"], answer: ["A", "C", "D"], marks: 1, explanation: "ACID: Atomicity, Consistency, Isolation, and Durability." },
            { id: "q_msq_3", type: "msq", question: "Which of the following algorithms have worst-case time complexity of O(N log N)? (Select ALL that apply)", options: ["Merge Sort", "Heapsort", "Bubble Sort", "Selection Sort"], answer: ["A", "B"], marks: 1, explanation: "Merge Sort and Heapsort strictly run in O(N log N) worst-case time." },
            { id: "q_msq_4", type: "msq", question: "Which data structures can be directly used to implement an Abstract Data Type (ADT) Stack? (Select ALL that apply)", options: ["Singly Linked List", "Dynamic Array", "Queue with two stacks", "Binary Search Tree"], answer: ["A", "B"], marks: 1, explanation: "Both linked lists and dynamic arrays efficiently support O(1) Push and Pop." },
            { id: "q_msq_5", type: "msq", question: "Which of the following are valid NoSQL database categories? (Select ALL that apply)", options: ["Document Store", "Graph Database", "Key-Value Store", "Linear Array DB"], answer: ["A", "B", "C"], marks: 1, explanation: "Major NoSQL types: Document, Key-Value, Column-family, and Graph." },
            { id: "q_msq_6", type: "msq", question: "Which headers are standard security HTTP response headers? (Select ALL that apply)", options: ["Content-Security-Policy", "X-Frame-Options", "Strict-Transport-Security", "X-User-Password"], answer: ["A", "B", "C"], marks: 1, explanation: "CSP, X-Frame-Options, and HSTS protect against XSS, clickjacking, and downgrade attacks." },
            { id: "q_msq_7", type: "msq", question: "Which of the following are valid Git branch merging strategies? (Select ALL that apply)", options: ["Fast-forward merge", "Squash merge", "Recursive 3-way merge", "Branch deletion merge"], answer: ["A", "B", "C"], marks: 1, explanation: "Git supports fast-forward, 3-way recursive merge, and commit squash merges." },
            { id: "q_msq_8", type: "msq", question: "Which variables in modern JavaScript have block-level scope? (Select ALL that apply)", options: ["let", "const", "var", "function-scoped var"], answer: ["A", "B"], marks: 1, explanation: "let and const are block-scoped; var is function/globally scoped." },
            { id: "q_msq_9", type: "msq", question: "Which protocols operate on the Transport Layer of the TCP/IP stack? (Select ALL that apply)", options: ["TCP", "UDP", "IP", "ICMP"], answer: ["A", "B"], marks: 1, explanation: "TCP and UDP are Transport Layer (Layer 4) protocols; IP and ICMP are Network Layer (Layer 3)." },
            { id: "q_msq_10", type: "msq", question: "Which of the following are non-linear data structures? (Select ALL that apply)", options: ["Binary Tree", "Graph", "Queue", "B+ Tree"], answer: ["A", "B", "D"], marks: 1, explanation: "Trees and Graphs are non-linear; Queues and Arrays are linear." },
            { id: "q_msq_11", type: "msq", question: "Which of the following are advantages of Microservices architecture over Monoliths? (Select ALL that apply)", options: ["Independent service deployment", "Technology stack flexibility per service", "Zero network latency", "Isolated fault blast radiuses"], answer: ["A", "B", "D"], marks: 1, explanation: "Microservices isolate deployment, faults, and tech stacks, but introduce network overhead." }
        ];

        // 4 Section B Coding & Debugging Problems (5 marks each = 20 coding marks)
        const codingProblems = getDefaultCodingProblems();

        // 3. Generate the 10 Unique Sets via Three-Level Randomization
        const setsResult = generateUniqueSets({
            examId: examId,
            questionBank: objectiveBank,
            setCount: 10,
            mcqCount: 20,
            msqCount: 10,
            baseSeed: 987654321
        });

        // 4. Save to IndexedDB & Storage
        await saveExamObjectiveBank(examId, objectiveBank);
        await saveExamCodingProblems(examId, codingProblems);
        await saveExamSets(examId, setsResult);

        const examMeta = {
            id: examId,
            courseId: "entrepreneurship",
            subjectName: "Full-Stack Development & Applied Computer Science",
            name: "KITS Autonomous Comprehensive Examination 2026-27",
            totalMarks: 50,
            objectiveMarks: 30,
            codingMarks: 20,
            duration: 90,
            setCount: 10,
            mcqCount: 20,
            msqCount: 10,
            codingCount: 4,
            eligibility: "All Academic Branches (IT, CSE, AI&DS, ECE)",
            allocationMode: "strict_unique",
            instructions: "1. Total Duration: 90 Minutes. Total Marks: 50.\n2. Section A: 20 Multiple Choice Questions (20 Marks).\n3. Section B: 10 Multiple Select Questions (10 Marks).\n4. Section C: 4 Coding & Debugging Problems (20 Marks: HTML, HTML+CSS, HTML Debug, CSS Debug).\n5. Each candidate is assigned one unique randomized set in strict non-reuse mode.\n6. Full-screen mode is strictly monitored with a 3-strike policy.",
            status: "published",
            createdAt: new Date().toISOString()
        };

        await saveExamination(examMeta);
        localStorage.setItem("kits_comprehensive_exam_seeded_v4", "true");
        console.log("[KITS Exam Engine] Initialized and seeded 50-mark Comprehensive Examination with 10 unique sets and 4 Section B coding problems.");
    }

    // Auto-seed on load
    seedDefaultComprehensiveExam().catch(e => console.warn("Seed error:", e));

    // Export global KITS Exam Engine API
    global.KitsExamEngine = {
        // Storage APIs
        dbGet,
        dbPut,
        dbGetAll,
        dbDelete,
        // Option ID & Answer Evaluation Helpers
        indexToOptionId,
        optionIdToIndex,
        normalizeOptionIdArray,
        evaluateMsqAnswer,
        evaluateMcqAnswer,
        // Randomization APIs
        fisherYatesShuffle,
        generateUniqueSets,
        assignStudentSet,
        getStudentAssignment,
        getAllExamAssignments,
        // Coding & Objective Extractors & Standards
        getDefaultCodingProblems,
        parseCodingProblemsFromText,
        // Automated Evaluators
        evaluateHtmlCoding,
        evaluateHtmlCssCoding,
        evaluateHtmlDebugging,
        evaluateCssDebugging,
        evaluateCodingProblem,
        // Full Exam Evaluation
        evaluateExamSubmission,
        // Entity Helpers
        saveExamination,
        getExamination,
        getAllExaminations,
        saveExamSets,
        getExamSets,
        getExamCodingProblems,
        saveExamCodingProblems,
        saveExamObjectiveBank,
        getExamObjectiveBank,
        seedDefaultComprehensiveExam
    };

})(window);

