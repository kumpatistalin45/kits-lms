/**
 * KITS LMS — Examination Engine & Deterministic Randomization Module
 * 
 * Implements:
 * 1. Student-wise deterministic question sequence and option sequence
 *    seeded by the last two digits/characters of the student's roll number.
 * 2. Independent question randomization and option randomization per question.
 * 3. Preservation of original question bank as source of truth.
 * 4. Stable question IDs and option IDs throughout examination lifecycle.
 * 5. Full support for Single-Choice MCQs and Multiple-Choice MSQs.
 * 6. Answer evaluation mapping displayed option selections back to original option IDs.
 * 7. Complete Itemized Review payload containing question statements, all 4 options,
 *    student choices, correct answers, and academic explanations in the student's exact sequence.
 * 8. Backward-compatible 10-set allocation utilities for historical records.
 */

const crypto = require("crypto");

// Linear Congruential PRNG with 32-bit state for reproducible sequence generation
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

/**
 * Extracts a deterministic integer seed from the last two digits/characters of a roll number.
 * Supports standard digits (e.g. "07" -> 7, "67" -> 67) as well as alphanumeric suffixes ("A2", "B0").
 */
function getRollNumberSeed(rollNumber) {
    const clean = String(rollNumber || "").trim().toUpperCase();
    if (!clean) return 42;

    // Extract last two characters
    const lastTwo = clean.slice(-2);

    // If standard digits, parse directly as base 10 (e.g. "07" -> 7, "24" -> 24, "67" -> 67)
    if (/^\d+$/.test(lastTwo)) {
        return parseInt(lastTwo, 10);
    }

    // For alphanumeric suffixes, parse base-36 or char codes
    let val = parseInt(lastTwo, 36);
    if (isNaN(val)) {
        val = ((lastTwo.charCodeAt(0) || 0) * 31 + (lastTwo.charCodeAt(1) || 0));
    }
    return Math.abs(val);
}

// Fisher-Yates shuffle algorithm
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
 * [{ originalId: "A", text: "..." }, { originalId: "B", text: "..." }, ...]
 */
function extractOptions(q) {
    if (Array.isArray(q.options) && q.options.length > 0) {
        return q.options.map((opt, idx) => {
            if (typeof opt === "object" && opt !== null) {
                return {
                    originalId: opt.originalId || opt.id || opt.letter || opt.key || OPTION_LETTERS[idx] || String(idx + 1),
                    text: String(opt.text || opt.label || "")
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
 * Normalizes a question into a clean master question entity.
 * Keeps original bank untouched.
 */
function normalizeMasterQuestion(q, idx) {
    const qId = q.id ? String(q.id) : `q_${q.question_number || (idx + 1)}`;
    const qNum = Number(q.question_number || (idx + 1));
    const qText = q.question_text || q.statement || q.question || "";
    const opts = extractOptions(q);
    const correct = extractCorrectAnswers(q);
    const isMsq = Boolean(q.type === "msq" || correct.length > 1);

    return {
        originalQuestionId: qId,
        originalQuestionNumber: qNum,
        questionText: qText,
        options: opts,
        correctAnswers: correct,
        explanation: q.explanation || "",
        type: isMsq ? "msq" : "mcq",
        marks: Number(q.marks || 1)
    };
}

/**
 * Generates a deterministic examination arrangement for a student.
 * Uses the last two digits of the student's roll number as the seed.
 * 
 * Requirements:
 * 1. Independent question shuffling.
 * 2. Independent option shuffling per question.
 * 3. Never modifies the original question bank.
 * 4. Preserves mapping between original option IDs and displayed option positions.
 */
function generateStudentExamArrangement(exam, rollNumber) {
    const rawQuestions = exam.questions || [];
    const cleanRoll = String(rollNumber || "").trim().toUpperCase();
    const rollSeed = getRollNumberSeed(cleanRoll);
    const examSeed = stringToSeed(exam.id || "exam_kits");

    // Master seed for student in this exam
    const studentSeed = (examSeed + rollSeed * 7919 + 104729) % 2147483647;

    const masterQuestions = rawQuestions.map((q, idx) => normalizeMasterQuestion(q, idx));

    // 1. Question Randomization (Deterministic Fisher-Yates with qPrng)
    const qPrng = createPrng(studentSeed + 1337);
    const shuffledQuestions = fisherYatesShuffle(masterQuestions, qPrng);

    // 2. Option Randomization (Independent per question with optPrng)
    const displayedQuestions = shuffledQuestions.map((origQ, displayIdx) => {
        const displayNum = displayIdx + 1;
        const optPrng = createPrng(studentSeed + 99991 + (displayIdx + 1) * 541);
        const shuffledOpts = fisherYatesShuffle(origQ.options, optPrng);

        const displayedOptionsObj = {};
        const displayedOptionsArray = [];
        const remappedCorrectLetters = [];
        const displayToOriginalMap = {};
        const originalToDisplayMap = {};

        shuffledOpts.forEach((opt, optIdx) => {
            const letter = OPTION_LETTERS[optIdx] || `OPT${optIdx + 1}`;
            displayedOptionsObj[`option_${letter.toLowerCase()}`] = opt.text;
            displayToOriginalMap[letter] = opt.originalId;
            originalToDisplayMap[opt.originalId] = letter;

            displayedOptionsArray.push({
                key: letter,
                letter: letter,
                text: opt.text,
                originalOptionId: opt.originalId
            });

            if (origQ.correctAnswers.includes(opt.originalId.toUpperCase())) {
                remappedCorrectLetters.push(letter);
            }
        });

        remappedCorrectLetters.sort();

        return {
            display_number: displayNum,
            question_number: displayNum,
            original_question_id: origQ.originalQuestionId,
            original_question_number: origQ.originalQuestionNumber,
            question_text: origQ.questionText,
            statement: origQ.questionText,
            type: origQ.type,
            marks: origQ.marks,
            explanation: origQ.explanation,
            ...displayedOptionsObj,
            options: displayedOptionsArray,
            display_to_original_map: displayToOriginalMap,
            original_to_display_map: originalToDisplayMap,
            displayed_correct_answer: remappedCorrectLetters[0] || "A",
            displayed_correct_answers: remappedCorrectLetters,
            correct_answer: remappedCorrectLetters[0] || "A",
            correct_answers: remappedCorrectLetters,
            original_correct_answers: origQ.correctAnswers
        };
    });

    const setNumber = (rollSeed % 10) + 1;
    const setLetter = String.fromCharCode(64 + setNumber);

    return {
        rollNumber: cleanRoll,
        rollSeed: rollSeed,
        setNumber: setNumber,
        setLetter: setLetter,
        setName: `Set ${setNumber} (${setLetter})`,
        examId: exam.id,
        examTitle: exam.title || exam.name || "50-MCQ Online Examination",
        totalQuestions: displayedQuestions.length,
        totalMarks: displayedQuestions.reduce((sum, q) => sum + (q.marks || 1), 0),
        questions: displayedQuestions,
        questionOrder: displayedQuestions.map(q => q.original_question_id),
        optionOrder: displayedQuestions.map(q => ({
            questionId: q.original_question_id,
            displayMap: q.display_to_original_map
        }))
    };
}

/**
 * Sanitizes an arrangement for client presentation by stripping answer keys and explanations.
 */
function sanitizeArrangementForStudent(arrangement) {
    if (!arrangement || !arrangement.questions) return null;
    return {
        rollNumber: arrangement.rollNumber,
        setNumber: arrangement.setNumber,
        setLetter: arrangement.setLetter,
        setName: arrangement.setName,
        examId: arrangement.examId,
        examTitle: arrangement.examTitle,
        totalQuestions: arrangement.totalQuestions,
        totalMarks: arrangement.totalMarks,
        questions: arrangement.questions.map(q => ({
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
 * Server-Side Evaluation for a student's arrangement.
 * 
 * Rules:
 * 1. Evaluates student selections using stable option identities.
 * 2. Maps displayed selections back to original option IDs.
 * 3. Compares mapped original selections against original correct answers.
 * 4. For MSQ, evaluates complete selected option sets (order-independent).
 * 5. Handles unanswered questions properly (skipped).
 * 6. Generates full itemizedReview containing question statements, options, choices, and explanations.
 */
function evaluateStudentSubmission(submittedAnswers, arrangement) {
    if (!arrangement || !arrangement.questions) {
        throw new Error("Invalid student examination arrangement for evaluation");
    }

    const answersMap = submittedAnswers || {};
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;
    let totalScore = 0;
    const itemizedReview = [];

    arrangement.questions.forEach(q => {
        const qNum = q.display_number || q.question_number;
        const candidateRaw = answersMap[qNum] || answersMap[String(qNum)] || null;
        const qMarks = Number(q.marks || 1);
        const isMsq = (q.type === "msq");

        let isCorrect = false;
        let isSkipped = false;
        let candidateDisplayedChoice = null;
        let candidateOriginalIds = [];

        if (isMsq) {
            let selectedLetters = [];
            if (Array.isArray(candidateRaw)) {
                selectedLetters = candidateRaw.map(s => String(s).trim().toUpperCase());
            } else if (typeof candidateRaw === "string" && candidateRaw.trim().length > 0) {
                selectedLetters = candidateRaw.split(",").map(s => s.trim().toUpperCase());
            }
            selectedLetters = [...new Set(selectedLetters)].sort();
            candidateDisplayedChoice = selectedLetters;

            if (selectedLetters.length === 0) {
                isSkipped = true;
                skippedCount++;
            } else {
                // Map displayed letters to original option IDs
                candidateOriginalIds = selectedLetters.map(letter => {
                    return q.display_to_original_map ? q.display_to_original_map[letter] : letter;
                }).filter(Boolean);

                const correctOriginalIds = [...q.original_correct_answers].sort();
                candidateOriginalIds.sort();

                if (candidateOriginalIds.length === correctOriginalIds.length &&
                    candidateOriginalIds.every((val, i) => val === correctOriginalIds[i])) {
                    isCorrect = true;
                    correctCount++;
                    totalScore += qMarks;
                } else {
                    wrongCount++;
                }
            }
        } else {
            const selectedLetter = candidateRaw ? String(candidateRaw).trim().toUpperCase() : null;
            candidateDisplayedChoice = selectedLetter;

            if (!selectedLetter) {
                isSkipped = true;
                skippedCount++;
            } else {
                // Map displayed letter to original option ID
                const candidateOriginalId = q.display_to_original_map ? q.display_to_original_map[selectedLetter] : selectedLetter;

                // Compare with original correct answer (or compare displayed letter with displayed correct answer)
                if (q.original_correct_answers.includes(candidateOriginalId) || selectedLetter === q.displayed_correct_answer) {
                    isCorrect = true;
                    correctCount++;
                    totalScore += qMarks;
                } else {
                    wrongCount++;
                }
            }
        }

        itemizedReview.push({
            displayNumber: qNum,
            display_number: qNum,
            question_number: qNum,
            originalQuestionId: q.original_question_id,
            original_question_id: q.original_question_id,
            questionText: q.question_text,
            question_text: q.question_text,
            statement: q.question_text,
            type: q.type || "mcq",
            option_a: q.option_a,
            option_b: q.option_b,
            option_c: q.option_c,
            option_d: q.option_d,
            options: q.options || [
                { key: "A", text: q.option_a },
                { key: "B", text: q.option_b },
                { key: "C", text: q.option_c },
                { key: "D", text: q.option_d }
            ],
            student_answer: candidateDisplayedChoice,
            candidateChoice: candidateDisplayedChoice,
            correct_answer: isMsq ? q.displayed_correct_answers : q.displayed_correct_answer,
            correctAnswer: isMsq ? q.displayed_correct_answers : q.displayed_correct_answer,
            isCorrect: isCorrect,
            is_correct: isCorrect,
            isSkipped: isSkipped,
            is_skipped: isSkipped,
            marksAwarded: isCorrect ? qMarks : 0,
            marks_awarded: isCorrect ? qMarks : 0,
            maxMarks: qMarks,
            explanation: q.explanation || ""
        });
    });

    const totalQuestions = arrangement.questions.length;
    const maxMarks = arrangement.totalMarks || totalQuestions;
    const percentage = maxMarks > 0 ? Math.round((totalScore / maxMarks) * 100 * 10) / 10 : 0;
    const status = percentage >= 40 ? "Pass" : "Fail";

    return {
        rollNumber: arrangement.rollNumber,
        setNumber: arrangement.setNumber,
        setName: arrangement.setName,
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

// =========================================================================
// BACKWARD COMPATIBILITY: 10-SET ALLOCATION & EVALUATION UTILITIES
// =========================================================================

function generate10RandomizedSets(exam) {
    const rawQuestions = exam.questions || [];
    const baseExamSeed = stringToSeed(exam.id || "exam_kits");

    const masterQuestions = rawQuestions.map((q, idx) => normalizeMasterQuestion(q, idx));
    const sets = [];
    const sequenceSignatures = new Set();

    for (let setNum = 1; setNum <= 10; setNum++) {
        const setPrng = createPrng(baseExamSeed + setNum * 104729);
        let shuffledQuestions = fisherYatesShuffle(masterQuestions, setPrng);

        let sig = shuffledQuestions.map(q => q.originalQuestionId).join(",");
        let retries = 0;
        while (sequenceSignatures.has(sig) && retries < 20) {
            shuffledQuestions = fisherYatesShuffle(shuffledQuestions, setPrng);
            sig = shuffledQuestions.map(q => q.originalQuestionId).join(",");
            retries++;
        }
        sequenceSignatures.add(sig);

        const setQuestions = shuffledQuestions.map((origQ, orderIdx) => {
            const optPrng = createPrng(baseExamSeed + setNum * 7919 + (orderIdx + 1) * 389);
            const shuffledOpts = fisherYatesShuffle(origQ.options, optPrng);

            const remappedCorrect = [];
            const displayedOptions = {};
            const displayToOriginalMap = {};

            shuffledOpts.forEach((opt, newIdx) => {
                const newLetter = OPTION_LETTERS[newIdx] || `OPT${newIdx + 1}`;
                displayedOptions[`option_${newLetter.toLowerCase()}`] = opt.text;
                displayToOriginalMap[newLetter] = opt.originalId;

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
                explanation: origQ.explanation,
                ...displayedOptions,
                options: shuffledOpts.map((o, i) => ({
                    key: OPTION_LETTERS[i],
                    letter: OPTION_LETTERS[i],
                    text: o.text,
                    originalOptionId: o.originalId
                })),
                display_to_original_map: displayToOriginalMap,
                displayed_correct_answer: remappedCorrect[0] || "A",
                displayed_correct_answers: remappedCorrect,
                correct_answer: remappedCorrect[0] || "A",
                correct_answers: remappedCorrect,
                original_correct_answers: origQ.correctAnswers
            };
        });

        const setLetter = String.fromCharCode(64 + setNum);
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

function getOrAllocateStudentSet(exam, rollNumber, existingAttempt, allAttemptsForExam = []) {
    // If student already has an arrangement, use it
    const arrangement = generateStudentExamArrangement(exam, rollNumber);
    return {
        set: arrangement,
        isNewAssignment: !existingAttempt,
        setNumber: arrangement.setNumber
    };
}

function sanitizeSetForStudent(setObj) {
    return sanitizeArrangementForStudent(setObj);
}

function evaluateSetSubmission(submittedAnswers, assignedSet) {
    return evaluateStudentSubmission(submittedAnswers, assignedSet);
}

module.exports = {
    getRollNumberSeed,
    generateStudentExamArrangement,
    sanitizeArrangementForStudent,
    evaluateStudentSubmission,
    generate10RandomizedSets,
    getExam10Sets,
    clearExamSetsCache,
    getOrAllocateStudentSet,
    sanitizeSetForStudent,
    evaluateSetSubmission,
    fisherYatesShuffle,
    createPrng
};
