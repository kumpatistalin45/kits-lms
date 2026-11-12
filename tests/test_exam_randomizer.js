/**
 * Unit Test Suite for 10 Randomized Sets System
 * Verifies all 7 core integrity constraints specified by the user.
 */

const assert = require("assert");
const { DEFAULT_50_MCQS } = require("../exam-default-data");
const {
    generate10RandomizedSets,
    getOrAllocateStudentSet,
    evaluateSetSubmission,
    sanitizeSetForStudent
} = require("../exam-randomizer");

// Create a realistic exam with 45 MCQs and 5 MSQs to test both types
const testExam = {
    id: "exam_test_randomizer_50",
    title: "Randomization Verification Assessment",
    duration_minutes: 60,
    questions: DEFAULT_50_MCQS.map((q, idx) => {
        if (idx >= 45) {
            // Convert last 5 questions to MSQ with multiple answers
            return {
                ...q,
                type: "msq",
                correct_answers: ["A", "C"],
                correct_answer: "A,C"
            };
        }
        return {
            ...q,
            type: "mcq"
        };
    })
};

console.log("==================================================================");
console.log("  KITS LMS — 10 RANDOMIZED SETS INTEGRITY VERIFICATION SUITE");
console.log("==================================================================\n");

let passed = 0;
let total = 0;

function check(cond, description, detail = "") {
    total++;
    if (cond) {
        console.log(`  [PASS] Check ${total}: ${description}`);
        passed++;
    } else {
        console.error(`  [FAIL] Check ${total}: ${description}`);
        if (detail) console.error(`         ${detail}`);
    }
}

// 1. Generate 10 sets
const sets = generate10RandomizedSets(testExam);
check(sets.length === 10, "Generates exactly 10 distinct randomized question sets");

// 2. All 10 sets contain all 50 original questions (no duplicates, no omissions)
let allSetsContainAllQuestions = true;
let allSetsHave50Questions = true;
const originalQuestionIds = new Set(testExam.questions.map((q, i) => `q_${q.question_number || (i + 1)}`));

sets.forEach((set, sIdx) => {
    if (set.questions.length !== 50) allSetsHave50Questions = false;
    const setQIds = new Set(set.questions.map(q => q.original_question_id));
    if (setQIds.size !== 50) allSetsContainAllQuestions = false;
    originalQuestionIds.forEach(id => {
        if (!setQIds.has(id)) allSetsContainAllQuestions = false;
    });
});

check(allSetsHave50Questions, "Every set has exactly 50 questions");
check(allSetsContainAllQuestions, "All 10 sets contain every single original question with zero omissions and zero duplicates");

// 3. Question sequences differ across sets
const signatures = new Set(sets.map(s => s.questions.map(q => q.original_question_id).join(",")));
check(signatures.size === 10, "All 10 sets have distinct question sequences (valid question order randomization)");

// 4. Option Shuffling: options are shuffled and differ across sets for questions
let optionsDifferAcrossSets = false;
for (let i = 0; i < 9; i++) {
    const qA = sets[i].questions[0];
    const qB = sets[i + 1].questions[0];
    if (qA.option_a !== qB.option_a || qA.option_b !== qB.option_b) {
        optionsDifferAcrossSets = true;
        break;
    }
}
check(optionsDifferAcrossSets, "Options are independently shuffled across sets");

// 5. Correct answers remain correct after option shuffling
let allRemappedAnswersCorrect = true;
sets.forEach(set => {
    set.questions.forEach(q => {
        const origQ = testExam.questions.find(orig => (orig.id || `q_${orig.question_number}`) === q.original_question_id);
        if (!origQ) {
            allRemappedAnswersCorrect = false;
            return;
        }

        // Verify MCQ remapping
        if (q.type === "mcq") {
            const displayedCorrectText = q[`option_${q.correct_answer.toLowerCase()}`];
            const origCorrectLetter = origQ.correct_answer.toLowerCase();
            const origCorrectText = origQ[`option_${origCorrectLetter}`];
            if (displayedCorrectText !== origCorrectText) {
                allRemappedAnswersCorrect = false;
                console.error(`Mismatch for ${q.original_question_id} in Set ${set.setNumber}: displayed='${displayedCorrectText}' vs orig='${origCorrectText}'`);
            }
        } else if (q.type === "msq") {
            // Verify MSQ remapping
            const displayedTexts = q.correct_answers.map(ltr => q[`option_${ltr.toLowerCase()}`]).sort();
            const origTexts = origQ.correct_answers.map(ltr => origQ[`option_${ltr.toLowerCase()}`]).sort();
            if (displayedTexts.join("|") !== origTexts.join("|")) {
                allRemappedAnswersCorrect = false;
            }
        }
    });
});
check(allRemappedAnswersCorrect, "Correct answer mapping remains 100% truthful after option shuffling");

// 6. MCQ and MSQ Evaluation Test
// Test a simulated submission with 100% correct answers
const sampleSet = sets[0];
const perfectSubmission = {};
sampleSet.questions.forEach(q => {
    if (q.type === "msq") {
        perfectSubmission[q.display_number] = q.correct_answers; // array of correct options
    } else {
        perfectSubmission[q.display_number] = q.correct_answer;
    }
});

const evalResult = evaluateSetSubmission(perfectSubmission, sampleSet);
check(evalResult.score === 50 && evalResult.correctCount === 50 && evalResult.percentage === 100,
    "Evaluation correctly awards 50/50 marks for perfectly matched MCQ and MSQ answers"
);

// Test partial/wrong MSQ answers
const partialSubmission = { ...perfectSubmission };
const msqQ = sampleSet.questions.find(q => q.type === "msq");
assert(Boolean(msqQ), "At least one MSQ question must exist in the set");
// Submit partial selection (e.g. only 1 of the required multiple options)
partialSubmission[msqQ.display_number] = [msqQ.correct_answers[0]];
const partialEval = evaluateSetSubmission(partialSubmission, sampleSet);
check(partialEval.score === 49 && partialEval.wrongCount === 1,
    "MSQ evaluation strictly requires the complete correct option set (partial selection rejected)"
);

// 7. Student Set Allocation & Strict Set Retention
const mockAttempt = {
    examId: testExam.id,
    rollNumber: "22TEST001",
    set_number: 7 // Previously assigned Set 7
};

const retained = getOrAllocateStudentSet(testExam, "22TEST001", mockAttempt);
check(retained.setNumber === 7 && retained.isNewAssignment === false,
    "Refreshing or resuming an attempt strictly retains the same assigned set (Set 7 retained)"
);

// Balanced allocation across 10 students
const mockAttemptsList = [];
const assignedCounts = {};
for (let i = 1; i <= 10; i++) assignedCounts[i] = 0;

for (let i = 1; i <= 30; i++) {
    const roll = `22TEST${String(i).padStart(3, "0")}`;
    const alloc = getOrAllocateStudentSet(testExam, roll, null, mockAttemptsList);
    assignedCounts[alloc.setNumber]++;
    mockAttemptsList.push({
        examId: testExam.id,
        rollNumber: roll,
        set_number: alloc.setNumber
    });
}

const minAlloc = Math.min(...Object.values(assignedCounts));
const maxAlloc = Math.max(...Object.values(assignedCounts));
check(maxAlloc - minAlloc <= 1,
    `Balanced allocation evenly distributes sets (min: ${minAlloc}, max: ${maxAlloc} across 30 students)`
);

// 8. Sanitization Check (Zero answer keys leaked to frontend)
const sanitized = sanitizeSetForStudent(sampleSet);
let noAnswerKeysExposed = true;
sanitized.questions.forEach(q => {
    if (q.correct_answer !== undefined || q.correct_answers !== undefined || q.answer !== undefined) {
        noAnswerKeysExposed = false;
    }
});
check(noAnswerKeysExposed, "Sanitization strictly strips all answer keys and evaluation secrets from student view");

console.log("\n==================================================================");
console.log(`  RANDOMIZATION SUITE RESULT: ${passed} / ${total} CHECKS PASSED`);
console.log("==================================================================");

if (passed === total) {
    console.log("  >>> ALL 10-SET RANDOMIZATION INTEGRITY REQUIREMENTS VERIFIED <<<\n");
} else {
    process.exit(1);
}
