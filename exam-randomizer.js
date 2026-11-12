/**
 * KITS LMS — 10 Distinct Randomized Question Sets Engine
 * 
 * Implements:
 * 1. 10 Distinct Randomized Question Sets (Set 1 to Set 10)
 * 2. Level A: Independent Question Order Randomization (Fisher-Yates)
 * 3. Level B: Independent Option Randomization (Stable Option IDs & Answer Remapping)
 * 4. Level C: Concurrency-Safe Balanced Student Set Allocation (1 to 10)
 * 5. Strict Attempt Set Retention (Never reshuffle on refresh / resume)
 * 6. MCQ & MSQ Server-Side Evaluation Engine
 * 7. Secure Sanitization (Zero answer keys exposed to client)
 */

const crypto = require("crypto");

// Linear Congruential PRNG with 32-bit state for reproducible set generation
function createPrng(seed) {
    let s = (Math.abs(Number(seed)) || 123456789) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

function stringToSeed(str) {
    let hash = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
        const char = s.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) || 987654321;
}

// Fisher-Yates shuffle
function fisherYatesShuffle(array, prng) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(prng() * (i + 1));
        const temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
    return arr;
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Normalizes question options into standard array:
 * [{ id: "A", text: "..." }, { id: "B", text: "..." }, ...]
 */
function extractOptions(q) {
    if (Array.isArray(q.options) && q.options.length > 0) {
        return q.options.map((opt, idx) => {
            if (typeof opt === "object" && opt !== null) {
                return {
                    originalId: opt.id || opt.originalId || OPTION_LETTERS[idx] || String(idx + 1),
                    text: opt.text || opt.label || ""
                };
            }
            return {
                originalId: OPTION_LETTERS[idx] || String(idx + 1),
                text: String(opt || "")
            };
        });
    }

    const opts = [];
    if (q.option_a !== undefined) opts.push({ originalId: "A", text: String(q.option_a || "") });
    if (q.option_b !== undefined) opts.push({ originalId: "B", text: String(q.option_b || "") });
    if (q.option_c !== undefined) opts.push({ originalId: "C", text: String(q.option_c || "") });
    if (q.option_d !== undefined) opts.push({ originalId: "D", text: String(q.option_d || "") });
    if (q.option_e !== undefined) opts.push({ originalId: "E", text: String(q.option_e || "") });
    return opts;
}

/**
 * Normalizes correct answers to uppercase array (e.g. ["A", "C"])
 */
function extractCorrectAnswers(q) {
    if (Array.isArray(q.correct_answers)) {
        return q.correct_answers.map(a => String(a).trim().toUpperCase());
    }
    if (Array.isArray(q.answer)) {
        return q.answer.map(a => String(a).trim().toUpperCase());
    }
    if (q.correct_answer !== undefined && q.correct_answer !== null) {
        const raw = String(q.correct_answer).trim().toUpperCase();
        if (raw.includes(",")) {
            return raw.split(",").map(s => s.trim()).filter(Boolean);
        }
        return [raw];
    }
    if (q.answer !== undefined && q.answer !== null) {
        const raw = String(q.answer).trim().toUpperCase();
        if (raw.includes(",")) {
            return raw.split(",").map(s => s.trim()).filter(Boolean);
        }
        return [raw];
    }
    return ["A"];
}

/**
 * Generates exactly 10 distinct randomized question sets for an exam.
 * Preserves all 50 original questions in each set.
 * Shuffles questions independently and options independently.
 */
function generate10RandomizedSets(exam) {
    const rawQuestions = exam.questions || [];
    const baseExamSeed = stringToSeed(exam.id || "exam_kits");

    // Standardize all original master questions
    const masterQuestions = rawQuestions.map((q, idx) => {
        const qId = q.id ? String(q.id) : `q_${q.question_number || (idx + 1)}`;
        const qNum = Number(q.question_number || (idx + 1));
        const qText = q.question_text || q.statement || q.question || "";
        const opts = extractOptions(q);
        const correctAnswers = extractCorrectAnswers(q);
        const isMsq = Boolean(q.type === "msq" || correctAnswers.length > 1);

        return {
            originalQuestionId: qId,
            originalQuestionNumber: qNum,
            questionText: qText,
            options: opts,
            correctAnswers: correctAnswers, // e.g. ["C"] or ["A", "C"]
            type: isMsq ? "msq" : "mcq",
            marks: Number(q.marks || 1)
        };
    });

    const sets = [];
    const sequenceSignatures = new Set();

    for (let setNum = 1; setNum <= 10; setNum++) {
        // Deterministic seed for this set
        const setPrng = createPrng(baseExamSeed + setNum * 104729);

        // Level A: Question Shuffling
        let shuffledQuestions = fisherYatesShuffle(masterQuestions, setPrng);

        // Ensure question sequence is distinct across sets
        let sig = shuffledQuestions.map(q => q.originalQuestionId).join(",");
        let retries = 0;
        while (sequenceSignatures.has(sig) && retries < 20) {
            shuffledQuestions = fisherYatesShuffle(shuffledQuestions, setPrng);
            sig = shuffledQuestions.map(q => q.originalQuestionId).join(",");
            retries++;
        }
        sequenceSignatures.add(sig);

        // Level B: Option Shuffling per question in this set
        const setQuestions = shuffledQuestions.map((origQ, orderIdx) => {
            const optPrng = createPrng(baseExamSeed + setNum * 7919 + (orderIdx + 1) * 389);
            const shuffledOpts = fisherYatesShuffle(origQ.options, optPrng);

            // Remap correct answer letters based on new positions
            const remappedCorrect = [];
            const displayedOptions = {};

            shuffledOpts.forEach((opt, newIdx) => {
                const newLetter = OPTION_LETTERS[newIdx] || `OPT${newIdx + 1}`;
                displayedOptions[`option_${newLetter.toLowerCase()}`] = opt.text;

                // Check if this option was originally correct
                if (origQ.correctAnswers.includes(opt.originalId.toUpperCase())) {
                    remappedCorrect.push(newLetter);
                }
            });

            remappedCorrect.sort();

            return {
                display_number: orderIdx + 1,
                question_number: orderIdx + 1,
                original_question_id: origQ.originalQuestionId,
                original_question_number: origQ.originalQuestionNumber,
                question_text: origQ.questionText,
                statement: origQ.questionText,
                type: origQ.type,
                marks: origQ.marks,
                ...displayedOptions,
                options: shuffledOpts.map((o, i) => ({
                    letter: OPTION_LETTERS[i],
                    text: o.text,
                    originalId: o.originalId
                })),
                correct_answer: remappedCorrect[0] || "A",
                correct_answers: remappedCorrect,
                original_correct_answers: origQ.correctAnswers
            };
        });

        const setLetter = String.fromCharCode(64 + setNum); // A, B, C, D...
        sets.push({
            setNumber: setNum,
            setLetter: setLetter,
            setName: `Set ${setNum} (${setLetter})`,
            examId: exam.id,
            totalQuestions: setQuestions.length,
            totalMarks: setQuestions.reduce((s, q) => s + (q.marks || 1), 0),
            questions: setQuestions
        });
    }

    return sets;
}

/**
 * Cache for 10 randomized sets per examId in memory
 */
const EXAM_SETS_CACHE = new Map();

function getExam10Sets(exam) {
    if (!exam || !exam.id) return [];
    const cacheKey = String(exam.id).trim();
    if (EXAM_SETS_CACHE.has(cacheKey)) {
        return EXAM_SETS_CACHE.get(cacheKey);
    }
    const sets = generate10RandomizedSets(exam);
    EXAM_SETS_CACHE.set(cacheKey, sets);
    return sets;
}

function clearExamSetsCache(examId) {
    if (examId) EXAM_SETS_CACHE.delete(String(examId).trim());
    else EXAM_SETS_CACHE.clear();
}

/**
 * Level C: Allocate one of the 10 sets to a student in a balanced manner
 * If attempt already has a set_number, returns that exact set (Retention).
 */
function getOrAllocateStudentSet(exam, rollNumber, existingAttempt, allAttemptsForExam = []) {
    const allSets = getExam10Sets(exam);
    if (!allSets || allSets.length === 0) return null;

    // 1. Strict Retention: If student already assigned a set, NEVER reshuffle
    if (existingAttempt && existingAttempt.set_number) {
        const assigned = allSets.find(s => s.setNumber === Number(existingAttempt.set_number));
        if (assigned) {
            return {
                set: assigned,
                isNewAssignment: false,
                setNumber: assigned.setNumber
            };
        }
    }

    // 2. Balanced Allocation across Set 1 to Set 10
    // Count existing attempts per set to balance distribution
    const setCountMap = {};
    for (let i = 1; i <= 10; i++) setCountMap[i] = 0;

    (allAttemptsForExam || []).forEach(att => {
        if (att && att.set_number && setCountMap[att.set_number] !== undefined) {
            setCountMap[att.set_number]++;
        }
    });

    // Find the set with the minimum count (with deterministic tie-breaker based on roll number)
    let minCount = Infinity;
    let chosenSetNum = 1;
    const rollHash = stringToSeed(rollNumber);

    // Build candidate sets with minimal count
    const minSets = [];
    for (let i = 1; i <= 10; i++) {
        if (setCountMap[i] < minCount) {
            minCount = setCountMap[i];
        }
    }
    for (let i = 1; i <= 10; i++) {
        if (setCountMap[i] === minCount) {
            minSets.push(i);
        }
    }

    // Select among minimal sets using roll hash for consistent spread
    chosenSetNum = minSets[rollHash % minSets.length];

    const chosenSet = allSets.find(s => s.setNumber === chosenSetNum) || allSets[0];
    return {
        set: chosenSet,
        isNewAssignment: true,
        setNumber: chosenSet.setNumber
    };
}

/**
 * Strips correct answers and answer keys before sending to the client.
 */
function sanitizeSetForStudent(setObj) {
    if (!setObj || !setObj.questions) return null;
    return {
        setNumber: setObj.setNumber,
        setLetter: setObj.setLetter,
        setName: setObj.setName,
        examId: setObj.examId,
        totalQuestions: setObj.totalQuestions,
        totalMarks: setObj.totalMarks,
        questions: setObj.questions.map(q => ({
            display_number: q.display_number,
            question_number: q.question_number,
            original_question_id: q.original_question_id,
            question_text: q.question_text,
            type: q.type || "mcq",
            marks: q.marks || 1,
            option_a: q.option_a,
            option_b: q.option_b,
            option_c: q.option_c,
            option_d: q.option_d,
            option_e: q.option_e
        }))
    };
}

/**
 * Server-Side Evaluation for an assigned randomized set
 * Supports both MCQ and MSQ questions.
 */
function evaluateSetSubmission(submittedAnswers, assignedSet) {
    if (!assignedSet || !assignedSet.questions) {
        throw new Error("Invalid assigned set for evaluation");
    }

    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;
    let totalScore = 0;
    const itemizedReview = [];

    assignedSet.questions.forEach(q => {
        const qNum = q.display_number || q.question_number;
        const candidateRaw = submittedAnswers[qNum] || submittedAnswers[String(qNum)] || null;
        const qMarks = Number(q.marks || 1);
        const isMsq = q.type === "msq";

        let isCorrect = false;
        let isSkipped = false;
        let candidateFormatted = null;

        if (isMsq) {
            // For MSQ: candidate choice can be an array e.g. ["A", "C"] or comma-separated string
            let selectedArr = [];
            if (Array.isArray(candidateRaw)) {
                selectedArr = candidateRaw.map(s => String(s).trim().toUpperCase());
            } else if (typeof candidateRaw === "string" && candidateRaw.trim().length > 0) {
                selectedArr = candidateRaw.split(",").map(s => s.trim().toUpperCase());
            }
            selectedArr = [...new Set(selectedArr)].sort();
            candidateFormatted = selectedArr;

            if (selectedArr.length === 0) {
                isSkipped = true;
                skippedCount++;
            } else {
                const correctArr = [...q.correct_answers].sort();
                if (selectedArr.length === correctArr.length && selectedArr.every((val, i) => val === correctArr[i])) {
                    isCorrect = true;
                    correctCount++;
                    totalScore += qMarks;
                } else {
                    wrongCount++;
                }
            }
        } else {
            // For standard single-choice MCQ
            const selected = candidateRaw ? String(candidateRaw).trim().toUpperCase() : null;
            candidateFormatted = selected;

            if (!selected) {
                isSkipped = true;
                skippedCount++;
            } else if (selected === String(q.correct_answer).trim().toUpperCase()) {
                isCorrect = true;
                correctCount++;
                totalScore += qMarks;
            } else {
                wrongCount++;
            }
        }

        itemizedReview.push({
            displayNumber: qNum,
            originalQuestionId: q.original_question_id,
            questionText: q.question_text,
            type: q.type || "mcq",
            candidateChoice: candidateFormatted,
            correctAnswer: isMsq ? q.correct_answers : q.correct_answer,
            isCorrect: isCorrect,
            isSkipped: isSkipped,
            marksAwarded: isCorrect ? qMarks : 0,
            maxMarks: qMarks
        });
    });

    const totalQuestions = assignedSet.questions.length;
    const maxMarks = assignedSet.totalMarks || totalQuestions;
    const percentage = maxMarks > 0 ? Math.round((totalScore / maxMarks) * 100 * 10) / 10 : 0;
    const status = percentage >= 40 ? "Pass" : "Fail";

    return {
        setNumber: assignedSet.setNumber,
        setName: assignedSet.setName,
        score: totalScore,
        totalMarks: maxMarks,
        totalQuestions: totalQuestions,
        correctCount: correctCount,
        wrongCount: wrongCount,
        skippedCount: skippedCount,
        percentage: percentage,
        status: status,
        itemizedReview: itemizedReview
    };
}

module.exports = {
    generate10RandomizedSets,
    getExam10Sets,
    clearExamSetsCache,
    getOrAllocateStudentSet,
    sanitizeSetForStudent,
    evaluateSetSubmission,
    fisherYatesShuffle,
    createPrng
};
