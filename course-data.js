/**
 * KITS LMS — Course Specifications & Academic Curricula
 * Production Baseline Configuration
 * Synthetic mock/filler question generation removed for production.
 */

(function(){
    "use strict";

    const SECTION_TIME = 30 * 60; // 30 minutes per objective section (90 minutes total exam)

    window.MOCKTEST_SECTION_TIME = SECTION_TIME;

    // Course structure definitions without fabricated demo questions
    window.MOCKTEST_COURSE_DATA = {
        entrepreneurship: {
            name: "Entrepreneurship & Venture Development",
            sections: [
                { id: 1, name: "Section A: Multiple Choice (MCQ)", type: "MCQ", duration: SECTION_TIME, requiredQuestions: 20, questionBank: [] },
                { id: 2, name: "Section A: Multi-Select (MSQ)", type: "MSQ", duration: SECTION_TIME, requiredQuestions: 10, questionBank: [] },
                { id: 3, name: "Section B: Coding & Debugging", type: "Coding", duration: SECTION_TIME, requiredQuestions: 4, questionBank: [] }
            ]
        },
        python: {
            name: "Programming in Python",
            sections: [
                { id: 1, name: "Section A: Multiple Choice (MCQ)", type: "MCQ", duration: SECTION_TIME, requiredQuestions: 20, questionBank: [] },
                { id: 2, name: "Section A: Multi-Select (MSQ)", type: "MSQ", duration: SECTION_TIME, requiredQuestions: 10, questionBank: [] },
                { id: 3, name: "Section B: Coding & Debugging", type: "Coding", duration: SECTION_TIME, requiredQuestions: 4, questionBank: [] }
            ]
        },
        dbms: {
            name: "Database Management Systems",
            sections: [
                { id: 1, name: "Section A: Multiple Choice (MCQ)", type: "MCQ", duration: SECTION_TIME, requiredQuestions: 20, questionBank: [] },
                { id: 2, name: "Section A: Multi-Select (MSQ)", type: "MSQ", duration: SECTION_TIME, requiredQuestions: 10, questionBank: [] },
                { id: 3, name: "Section B: Coding & Debugging", type: "Coding", duration: SECTION_TIME, requiredQuestions: 4, questionBank: [] }
            ]
        },
        "machine-learning": {
            name: "Machine Learning & AI Principles",
            sections: [
                { id: 1, name: "Section A: Multiple Choice (MCQ)", type: "MCQ", duration: SECTION_TIME, requiredQuestions: 20, questionBank: [] },
                { id: 2, name: "Section A: Multi-Select (MSQ)", type: "MSQ", duration: SECTION_TIME, requiredQuestions: 10, questionBank: [] },
                { id: 3, name: "Section B: Coding & Debugging", type: "Coding", duration: SECTION_TIME, requiredQuestions: 4, questionBank: [] }
            ]
        },
        "cloud-computing": {
            name: "Cloud Computing & Security",
            sections: [
                { id: 1, name: "Section A: Multiple Choice (MCQ)", type: "MCQ", duration: SECTION_TIME, requiredQuestions: 20, questionBank: [] },
                { id: 2, name: "Section A: Multi-Select (MSQ)", type: "MSQ", duration: SECTION_TIME, requiredQuestions: 10, questionBank: [] },
                { id: 3, name: "Section B: Coding & Debugging", type: "Coding", duration: SECTION_TIME, requiredQuestions: 4, questionBank: [] }
            ]
        },
        "data-structures": {
            name: "Data Structures & Algorithms",
            sections: [
                { id: 1, name: "Section A: Multiple Choice (MCQ)", type: "MCQ", duration: SECTION_TIME, requiredQuestions: 20, questionBank: [] },
                { id: 2, name: "Section A: Multi-Select (MSQ)", type: "MSQ", duration: SECTION_TIME, requiredQuestions: 10, questionBank: [] },
                { id: 3, name: "Section B: Coding & Debugging", type: "Coding", duration: SECTION_TIME, requiredQuestions: 4, questionBank: [] }
            ]
        },
        "computer-networks": {
            name: "Computer Networks & Security",
            sections: [
                { id: 1, name: "Section A: Multiple Choice (MCQ)", type: "MCQ", duration: SECTION_TIME, requiredQuestions: 20, questionBank: [] },
                { id: 2, name: "Section A: Multi-Select (MSQ)", type: "MSQ", duration: SECTION_TIME, requiredQuestions: 10, questionBank: [] },
                { id: 3, name: "Section B: Coding & Debugging", type: "Coding", duration: SECTION_TIME, requiredQuestions: 4, questionBank: [] }
            ]
        }
    };
})();
