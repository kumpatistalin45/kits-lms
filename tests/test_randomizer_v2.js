const {
    getRollNumberSeed,
    generateStudentExamArrangement,
    sanitizeArrangementForStudent,
    evaluateStudentSubmission
} = require("../exam-randomizer.js");

function runTests() {
    console.log("==================================================================");
    console.log("  KITS LMS — STUDENT-WISE DETERMINISTIC RANDOMIZATION & EVALUATION");
    console.log("==================================================================\n");

    let passed = 0;
    let total = 0;

    function assert(cond, name, details = "") {
        total++;
        if (cond) {
            console.log(`  [PASS] ${name}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${name}`);
            if (details) console.error(`         Details: ${details}`);
        }
    }

    // Sample master question bank
    const masterQuestions = [
        {
            id: "q_1",
            question_text: "What does HTML stand for?",
            option_a: "Hyper Text Markup Language", // Correct
            option_b: "High Text Machine Language",
            option_c: "Hyper Tool Markup Language",
            option_d: "Home Text Markup Language",
            correct_answer: "A",
            explanation: "HTML is standard markup for web pages.",
            marks: 1
        },
        {
            id: "q_2",
            question_text: "Which of the following are relational database systems?",
            option_a: "PostgreSQL", // Correct
            option_b: "MongoDB",
            option_c: "MySQL",      // Correct
            option_d: "Redis",
            correct_answers: ["A", "C"],
            type: "msq",
            explanation: "PostgreSQL and MySQL are relational; Mongo and Redis are NoSQL.",
            marks: 1
        },
        {
            id: "q_3",
            question_text: "What is the time complexity of binary search?",
            option_a: "O(N)",
            option_b: "O(log N)", // Correct
            option_c: "O(1)",
            option_d: "O(N^2)",
            correct_answer: "B",
            explanation: "Binary search halves the search space each step.",
            marks: 1
        }
    ];

    const exam = {
        id: "exam_test_101",
        title: "Web Engineering Assessment",
        questions: masterQuestions
    };

    // 1. Seed Check
    const seed1 = getRollNumberSeed("24JR5A1207");
    const seed2 = getRollNumberSeed("24JR5A1207");
    const seed3 = getRollNumberSeed("25JR1A12A2");
    assert(seed1 === seed2, "Same roll number yields identical seed (07 -> 7)");
    assert(seed1 !== seed3, "Different roll number suffixes yield distinct seeds");

    // 2. Deterministic Arrangement Check
    const arr1 = generateStudentExamArrangement(exam, "24JR5A1207");
    const arr2 = generateStudentExamArrangement(exam, "24JR5A1207");
    const arrDiff = generateStudentExamArrangement(exam, "25JR1A12A2");

    assert(JSON.stringify(arr1.questionOrder) === JSON.stringify(arr2.questionOrder),
        "Same roll number produces 100% identical question sequence across repeated calls");
    assert(JSON.stringify(arr1.questions[0].options) === JSON.stringify(arr2.questions[0].options),
        "Same roll number produces 100% identical option sequences across repeated calls");

    // Master bank untouched
    assert(masterQuestions[0].correct_answer === "A" && masterQuestions[0].option_a === "Hyper Text Markup Language",
        "Original master question bank remains completely untouched");

    // 3. Prompt Specific Evaluation Example Test
    // Original Q1: A: HTML (correct), B: Python, C: Java, D: C++
    const htmlPromptExam = {
        id: "exam_html",
        title: "Programming Basics",
        questions: [{
            id: "q_html",
            question_text: "Which markup language is used for web structure?",
            option_a: "HTML", // Correct
            option_b: "Python",
            option_c: "Java",
            option_d: "C++",
            correct_answer: "A",
            explanation: "HTML is used for web structure.",
            marks: 1
        }]
    };

    const studentArrangement = generateStudentExamArrangement(htmlPromptExam, "24JR5A1207");
    const qDisplayed = studentArrangement.questions[0];
    
    // Find which displayed letter currently holds "HTML"
    const htmlDisplayedLetter = qDisplayed.options.find(o => o.text === "HTML").key;
    const pythonDisplayedLetter = qDisplayed.options.find(o => o.text === "Python").key;

    // When student selects the displayed letter that has HTML:
    const evalCorrect = evaluateStudentSubmission({ "1": htmlDisplayedLetter }, studentArrangement);
    assert(evalCorrect.score === 1 && evalCorrect.correctCount === 1,
        `Student selecting HTML (displayed as Option ${htmlDisplayedLetter}) receives full 1 mark regardless of position!`);

    // When student selects Python:
    const evalWrong = evaluateStudentSubmission({ "1": pythonDisplayedLetter }, studentArrangement);
    assert(evalWrong.score === 0 && evalWrong.wrongCount === 1,
        `Student selecting incorrect option (displayed as Option ${pythonDisplayedLetter}) receives 0 marks`);

    // 4. MSQ Evaluation Check
    const msqExam = {
        id: "exam_msq",
        title: "Databases",
        questions: [{
            id: "q_db",
            question_text: "Select all relational database systems:",
            option_a: "PostgreSQL", // Correct
            option_b: "MongoDB",
            option_c: "MySQL",      // Correct
            option_d: "Redis",
            correct_answers: ["A", "C"],
            type: "msq",
            explanation: "PostgreSQL and MySQL are relational.",
            marks: 1
        }]
    };
    const msqArrangement = generateStudentExamArrangement(msqExam, "24JR5A1207");
    const msqQ = msqArrangement.questions[0];

    const postgresLetter = msqQ.options.find(o => o.text === "PostgreSQL").key;
    const mysqlLetter = msqQ.options.find(o => o.text === "MySQL").key;
    const mongoLetter = msqQ.options.find(o => o.text === "MongoDB").key;

    // Both correct selected (order-independent e.g. [mysql, postgres])
    const msqFullMatch = evaluateStudentSubmission({ "1": [mysqlLetter, postgresLetter] }, msqArrangement);
    assert(msqFullMatch.score === 1 && msqFullMatch.correctCount === 1,
        "MSQ order-independent full correct set selection awards 1 mark");

    // Partial selection (only Postgres) -> 0 marks
    const msqPartial = evaluateStudentSubmission({ "1": [postgresLetter] }, msqArrangement);
    assert(msqPartial.score === 0 && msqPartial.wrongCount === 1,
        "MSQ partial selection strictly awards 0 marks");

    // Extra incorrect selection (Postgres + MySQL + Mongo) -> 0 marks
    const msqExtra = evaluateStudentSubmission({ "1": [postgresLetter, mysqlLetter, mongoLetter] }, msqArrangement);
    assert(msqExtra.score === 0 && msqExtra.wrongCount === 1,
        "MSQ extra incorrect selection strictly awards 0 marks");

    // 5. Unanswered question check
    const evalSkipped = evaluateStudentSubmission({}, studentArrangement);
    assert(evalSkipped.score === 0 && evalSkipped.skippedCount === 1,
        "Unanswered question marked skipped (0 marks)");

    // 6. Sanitization Check
    const sanitized = sanitizeArrangementForStudent(studentArrangement);
    const hasSecretKey = sanitized.questions.some(q => q.correct_answer || q.correct_answers || q.explanation || q.display_to_original_map);
    assert(!hasSecretKey, "Sanitized student arrangement strictly strips all correct answer keys and internal maps");

    // 7. Full Itemized Review Data Completeness Check
    const reviewItem = evalCorrect.itemizedReview[0];
    assert(reviewItem.question_number === 1 && reviewItem.question_text && reviewItem.option_a && reviewItem.option_b && reviewItem.option_c && reviewItem.option_d,
        "itemizedReview delivers complete question statement and all 4 options");
    assert(reviewItem.student_answer === htmlDisplayedLetter, "itemizedReview records student's exact displayed selection");
    assert(reviewItem.correct_answer === htmlDisplayedLetter, "itemizedReview records displayed correct answer");
    assert(reviewItem.explanation && reviewItem.explanation.includes("web structure"), "itemizedReview delivers academic explanation");

    console.log("\n==================================================================");
    console.log(`  RANDOMIZATION & EVALUATION SUITE: ${passed} / ${total} CHECKS PASSED`);
    console.log("==================================================================");

    if (passed === total) {
        console.log("  >>> ALL ENGINE INTEGRITY CHECKS PASSED SUCCESSFULLY <<<\n");
    } else {
        process.exit(1);
    }
}

runTests();

