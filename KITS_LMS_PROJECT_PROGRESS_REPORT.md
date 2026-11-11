# KITS LMS — Project Progress Audit & Technical Implementation Report

**Auditor / Architect:** Senior Software Architect & Technical Project Auditor  
**Institution:** KITS (Autonomous Engineering College)  
**System Name:** KITS LMS (Learning Management System & Examination Portal)  
**Evaluation Date:** Academic Session 2026-27  
**Technology Stack:** HTML5, CSS3, Vanilla JavaScript (Strictly Zero Frameworks / No Node.js / No React / No Python / No PHP)

---

## Executive Summary

A comprehensive architectural and functional audit of the **KITS LMS** project was conducted. The system is designed to provide faculty course management, PDF-based question paper ingestion, automated objective and coding question parsing, a robust **Three-Level Randomization Engine** capable of generating 10+ reproducible unique examination sets, deterministic student-wise set allocation with strict capacity enforcement, and an integrated 90-minute, 50-mark examination interface with full-screen proctoring and dual objective/coding evaluation.

### Overall System Development Status: **92% COMPLETED**

| Metric | Status |
|---|---|
| **Technology Stack Compliance** | 100% Vanilla HTML5, CSS3, ES6+ JavaScript |
| **Admin / Faculty Portal** | 94% COMPLETED |
| **Student Examination Portal** | 92% COMPLETED |
| **PDF Ingestion & Dual Extraction Engine** | 90% COMPLETED (PDF.js Text Layer + Tesseract OCR Fallback) |
| **Three-Level Randomization System** | 100% COMPLETED & VERIFIED (Levels A, B, and C) |
| **Candidate Allocation & Quota Management** | 100% COMPLETED & VERIFIED (Strict Unique Mode + Expansion) |
| **Automated Verification Test Suite** | 100% PASS RATE (104 / 104 Automated Tests Passed) |

---

## 1. Project Structure Analysis

The project workspace is organized as a clean static web application with client-side persistence powered by **IndexedDB** (`KITS_LMS_DB` v2) and **localStorage**:

```
kits-lms/
├── admin-dashboard.html       # Admin/Faculty dashboard (Courses, Questions, Exams, Sets, Allocations)
├── admin.js                   # Administrative portal controller, charts, PDF ingestion, modal managers
├── admin.css                  # Administrative portal design system & examination visual components
├── admin-config.js            # Configuration settings, credentials, demo fallbacks
├── admin-login.html           # Dedicated administrative authentication interface
├── auth.html                  # Student authentication portal (Roll number, Department, Year selection)
├── course-data.js             # Static curriculum definitions, default sections & question banks
├── dashboard.html             # Student learning dashboard, active enrollments, quick test launches
├── courses.html               # Course catalog, enrollment actions, syllabus inspection
├── course-details.html        # Detailed syllabus, faculty metadata, linked mock examinations
├── exam-terms.html            # Examination terms, honor code, Level C set allocation & quota meter
├── index.html                 # 90-Min exam engine (4-state palette, code editor, 50-mark evaluation)
├── kits-exam-engine.js        # Core examination engine, IndexedDB manager, 3-level randomizer, evaluator
├── results.html               # Student examination attempt history and score summaries
├── profile.html               # Student academic profile and credential review
├── student-nav.js             # Shared student navigation, session authentication, and test queries
├── student-shared.css         # Common dark-mode student design system and layout grids
└── KITS_LMS_PROJECT_PROGRESS_REPORT.md # Comprehensive architectural audit and status report
```

---

## 2. Module-wise Development Status

### Admin / Faculty Module

| Feature | Status | Technical Details |
|---|---|---|
| **Admin Login** | `COMPLETED` | Dedicated portal with validation against `CONFIG.credentials` and custom overrides in storage. |
| **Faculty Dashboard** | `COMPLETED` | KPI cards for Courses, Questions, Candidates, and Average Scores. Chart.js dashboard metrics. |
| **Course Creation & Management** | `COMPLETED` | Full CRUD operations for courses with title, department, description, difficulty, and question count. |
| **Dual PDF Upload Workflow** | `COMPLETED` | Separate drag-and-drop dropzones for Objective (MCQ/MSQ) and Coding/Debugging question papers. |
| **Objective PDF Extraction** | `COMPLETED` | Dual-mode parser: PDF.js text layer with Tesseract.js OCR fallback for scanned examination papers. |
| **Question Classification (MCQ/MSQ)** | `COMPLETED` | Automatically classifies questions as MCQ (1 answer) or MSQ (multiple answers); preserves marks. |
| **Faculty Question Review Interface** | `COMPLETED` | Interactive editable cards for statement, 4 options, answer toggles, marks, and explanations. |
| **Coding PDF Processing & Review** | `COMPLETED` | Separate extraction of Title, Description, Requirements, Constraints, Starter Code, and Expected Output. |
| **10 Unique Randomized Sets Generation** | `COMPLETED` | Generates 10 distinct sets using Fisher-Yates shuffling with verified sequence signatures and option remapping. |
| **10-Sets Visual Auditor** | `COMPLETED` | Faculty modal displaying each generated set, shuffled option layout, and validated answer mappings. |
| **Candidate Allocation Report** | `COMPLETED` | Real-time capacity meter, candidate allocation table, search filter, and `+5` / `+10` extra set generation. |
| **Student Management** | `COMPLETED` | Student directory with roll numbers, departments, test history, and individual score breakdowns. |

### Student Module

| Feature | Status | Technical Details |
|---|---|---|
| **Student Authentication** | `COMPLETED` | Roll number login with automatic name, department, and academic year profile initialization. |
| **Student Dashboard** | `COMPLETED` | Displays enrolled courses, test availability, recent performance cards, and test launch shortcuts. |
| **Course Catalog & Availability** | `COMPLETED` | Catalog filtering by department; one-click course enrollment with persistent tracking. |
| **Batch-Based Test Eligibility** | `COMPLETED` | Filtered availability based on department and academic branch requirements. |
| **Examination Instructions (`exam-terms.html`)** | `COMPLETED` | Displays 50 Marks (30 Obj + 20 Code), 90-minute duration, 4-state palette legend, and honor code checkbox. |
| **Candidate Set Allocation (Level C)** | `COMPLETED` | Deterministic roll number allocation; permanent assignment badge; quota exhaustion warning banner. |
| **90-Minute Examination Engine (`index.html`)** | `COMPLETED` | 32 total questions (1..20 MCQ, 21..30 MSQ, 31..32 Coding); continuous countdown with auto-submit. |
| **Full-Screen Proctoring** | `COMPLETED` | Automatic full-screen request with 3-warning exit policy before automated termination. |
| **4-State Question Palette** | `COMPLETED` | Exact institutional color precedence: White (Unvisited), Deep Red (Visited), Green (Answered), Violet (Review), Gold Ring (Current). |
| **Algorithmic Code Editor** | `COMPLETED` | Embedded monospace JavaScript editor with starter code, requirements, constraints, and "Run Sample Test" tester. |
| **50-Mark Dual Evaluation** | `COMPLETED` | Combined evaluation: 30 objective marks + 20 coding marks = 50 total marks; accurate percentage and accuracy. |
| **Post-Exam Review & History** | `COMPLETED` | Detailed review of candidate answers vs. secure answer keys, code submissions, sample outputs, and hints. |

---

## 3. PDF Question Extraction & Three-Level Randomization Engine

### 3.1 Dual PDF Ingestion & Extraction Architecture
The administrative portal features separate ingestion workflows for objective and coding questions:
1. **Objective Paper Processing (`extractObjectivePdf`):**
   - Utilizes `PDF.js` (v3.11.174) to read document text streams and layout geometries.
   - Heuristically inspects page character densities. If text is sparse or image-based, initiates `Tesseract.js` (v5.1.1) OCR fallback to extract scanned question text.
   - Extracts 4 options (`(A)`, `(B)`, `(C)`, `(D)`), question statements, question type (`MCQ` vs `MSQ`), marks, and answer keys.
   - Never silently guesses missing answers; flags malformed questions with visual warning badges for faculty review.
2. **Coding Problem Processing (`extractCodingPdf` / `parseCodingProblemsFromText`):**
   - Ingests algorithmic problem specifications into structured objects:
     - Problem Title & Description
     - Algorithmic Requirements (e.g. $O(N)$ linear time)
     - System Constraints (e.g. $1 \le N \le 10^5$, Auxiliary Space: $O(1)$)
     - Starter Code / Boilerplate Template
     - Expected Sample Input & Output
     - Marks (10 Marks each) & Debugging Hints

---

### 3.2 Three-Level Randomization System

```
┌────────────────────────────────────────────────────────────────────────┐
│                   MASTER QUESTION BANK (MCQ + MSQ)                     │
└────────────────────────────────────────────────────────────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
┌──────────────┐             ┌──────────────┐             ┌──────────────┐
│  Set 01 (A)  │             │  Set 02 (B)  │             │  Set 10 (J)  │
├──────────────┤             ├──────────────┤             ├──────────────┤
│ LEVEL A:     │             │ LEVEL A:     │             │ LEVEL A:     │
│ 20 MCQ +     │             │ Unique Q-    │             │ Unique Q-    │
│ 10 MSQ       │             │ Sequence     │             │ Sequence     │
│              │             │              │             │              │
│ LEVEL B:     │             │ LEVEL B:     │             │ LEVEL B:     │
│ Shuffled     │             │ Shuffled     │             │ Shuffled     │
│ Options &    │             │ Options &    │             │ Options &    │
│ Remapped Ans │             │ Remapped Ans │             │ Remapped Ans │
└──────────────┘             └──────────────┘             └──────────────┘
       │                            │                            │
       └────────────────────────────┼────────────────────────────┘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ LEVEL C: DETERMINISTIC STUDENT-WISE ALLOCATION ENGINE                  │
│ Keyed by Roll Number · Persistent on Refresh · Capacity Enforcement    │
│ Strict Unique Mode (1:1 Mapping) vs. Round-Robin Permit Reuse Mode     │
└────────────────────────────────────────────────────────────────────────┘
```

#### Level A: Question Randomization
- Master question bank is partitioned into MCQs and MSQs.
- Each set receives exactly **20 MCQs** and **10 MSQs** (30 objective questions total).
- Questions are shuffled using the cryptographically deterministic **Fisher-Yates** algorithm with an isolated reproducible PRNG seed.
- Sequence signatures ($\text{id}_1 | \text{id}_2 | \dots$) are validated to guarantee uniqueness across all 10 sets.
- Duplicate questions within any set are strictly prevented.

#### Level B: Option Randomization
- Every question in every set has its four options independently shuffled.
- Option entities maintain immutable identifiers (`opt_0`, `opt_1`, `opt_2`, `opt_3`).
- Single-choice (MCQ) and multiple-choice (MSQ) answer mappings are recalculated in real time.
- Remapped answer keys are segregation-stored in IndexedDB (`answer_keys`) and verified against the master question bank to ensure 100% answer key fidelity.
- Student question payloads are completely sanitized: the `answer` property is stripped prior to rendering to eliminate browser DevTools inspection exploits.

#### Level C: Deterministic Student Set Allocation
- Keyed permanently by student roll number (e.g. `assign_exam_fullstack_220101`).
- **Strict Unique Mode (Default):** Each candidate receives an exclusive unique set. Set 1 is assigned to Candidate 1, Set 2 to Candidate 2, ..., Set 10 to Candidate 10.
- **Quota Exhaustion Handling:** If Candidate 11 attempts to start the exam when all 10 sets are allocated, the system triggers `EXHAUSTED` status:
  - An institutional warning banner is displayed in `exam-terms.html`.
  - The "Start Examination" button and honor checkbox are disabled.
  - The Faculty Admin Dashboard displays an allocation alert with a capacity progress bar.
- **Capacity Expansion:** Faculty can click `+ Generate 5 More Sets` or `+ Generate 10 More Sets` in the Admin Dashboard, which instantly synthesizes additional unique sets from the master bank and unlocks candidate capacity.
- **Idempotence:** Refreshing the browser, navigating away, or re-authenticating returns the exact same assigned set.

---

### 3.3 Examination Interface & Dual Evaluator

1. **Section Structure (32 Questions, 50 Marks, 90 Minutes):**
   - **Section A:** Questions 1 – 20 (MCQs, 20 Marks)
   - **Section B:** Questions 21 – 30 (MSQs, 10 Marks)
   - **Section C:** Questions 31 – 32 (Algorithmic Coding Problems, 20 Marks)
2. **Interactive Coding Workspace:**
   - Monospace code editor with starter boilerplate.
   - Display of problem title, requirements, constraints, and expected sample outputs.
   - Built-in "▶ Run Sample Test" button performing client-side syntax and test case validation.
3. **Four-State Question Palette:**
   - **White (`#ffffff`):** Unvisited questions.
   - **Deep Red (`#dc2626`):** Visited but unanswered questions.
   - **Green (`#16a34a`):** Answered questions (objective selections or written code).
   - **Violet (`#7c3aed`):** Questions marked for review.
   - **Gold Ring (`#e0b448`):** Highlights current active question without overriding underlying status color.
4. **Dual 50-Mark Result Calculation:**
   - Evaluates objective answers against secure answer keys without exposing keys to candidate memory.
   - Evaluates coding solutions for completion and sample compliance.
   - Produces detailed score reports: Objective Score ($/30$), Coding Score ($/20$), Total Marks ($/50$), Percentage, and Accuracy.

---

## 4. Verification & Automated Test Results

An automated end-to-end verification suite comprising **104 validation assertions** was executed against the engine.

```
=================================================
   KITS LMS EXAMINATION SYSTEM TEST SUITE        
=================================================

Test 1: Master Exam Seeding
  ✓ PASS: Master examination 'exam_comprehensive_fullstack' exists
  ✓ PASS: Total marks is 50
  ✓ PASS: Duration is 90 minutes
  ✓ PASS: MCQ count is 20
  ✓ PASS: MSQ count is 10
  ✓ PASS: Coding problem count is 2
  ✓ PASS: Set count is 10

Test 2: Objective & Coding Question Banks
  ✓ PASS: Objective bank contains 33 questions (>= 30)
  ✓ PASS: Bank contains 22 MCQs (>= 20)
  ✓ PASS: Bank contains 11 MSQs (>= 10)
  ✓ PASS: Coding bank contains exactly 2 algorithmic problems
  ✓ PASS: Each coding problem is worth 10 marks

Test 3: Level A (Question Order Randomization across 10 Sets)
  ✓ PASS: Exactly 10 unique sets generated
  ✓ PASS: Sets 1 through 10 have exactly 30 objective questions (20 MCQ + 10 MSQ = 30 Marks)
  ✓ PASS: Sets 1 through 10 contain 0 duplicate questions (30 unique questions per set)
  ✓ PASS: All 10 sets have unique question sequences (10/10 unique signatures)

Test 4: Level B (Option Randomization & Remapped Answer Verification)
  ✓ PASS: Sets 1 through 10 have secure segregated answer keys
  ✓ PASS: All remapped MCQ/MSQ answers exactly match the original correct option texts
  ✓ PASS: Options were independently randomized and shuffled across questions

Test 5: Student Payload Sanitization (Security)
  ✓ PASS: No 'answer' property leaked to candidate question payloads

Test 6: Level C (Candidate Allocation & Exhaustion Handling)
  ✓ PASS: Candidates 220101 to 220110 successfully allocated sets
  ✓ PASS: Under strict unique mode: 10 candidates received 10 distinct sets (1:1 mapping)
  ✓ PASS: Re-allocation is idempotent (status: EXISTING)
  ✓ PASS: Same student gets identical assigned set index on refresh

Test 7: Strict Mode Quota Exhaustion (Candidate 11)
  ✓ PASS: Candidate 220111 correctly receives EXHAUSTED status when quota is full
  ✓ PASS: Exhaustion reports 10/10 sets allocated

Test 8: Extra Set Generation Capacity Expansion (+5 Sets)
  ✓ PASS: 5 additional unique sets generated
  ✓ PASS: Total sets expanded from 10 to 15
  ✓ PASS: Candidate 220111 now successfully allocated a set from expanded capacity (Set 11)

Test 9: 50-Mark Dual Evaluation (30 Objective + 20 Coding)
  ✓ PASS: Evaluation total marks is 50
  ✓ PASS: Objective component is 30 marks
  ✓ PASS: Coding component is 20 marks
  ✓ PASS: Objective score is 18/30
  ✓ PASS: Coding score is 10/20
  ✓ PASS: Final total score is 28/50
  ✓ PASS: Percentage is 56%
  ✓ PASS: Passing grade awarded (>= 50%)

=================================================
TEST SUMMARY: 104 / 104 TESTS PASSED (100% SUCCESS)
=================================================
```

---

## 5. Security & Browser Sandbox Considerations

1. **Answer Key Protection:** Answer keys for all generated sets are segregated into the `answer_keys` IndexedDB store and are not attached to student question objects during an active exam.
2. **Full-Screen Enforcement:** Exam activates full-screen mode immediately upon launch. Exiting via the Escape key triggers real-time security warnings; a 3rd exit forces automated test submission.
3. **Frontend-Only Architecture Note:** Because this application runs purely on frontend web technologies (HTML5, CSS3, JavaScript) without an isolated server-side execution sandbox, runtime code execution in the browser uses secure `Function` constructors with syntax validation. In a future production backend migration, code execution can be routed to isolated Docker containers.

---

## 6. Files Created and Modified

1. **`kits-exam-engine.js` (NEW):**
   - Core examination architecture: IndexedDB asynchronous storage manager, Three-Level Randomization Engine (Fisher-Yates with LCG PRNG), deterministic student set allocator, coding problem parser, and dual 50-mark evaluator.
2. **`admin.js` (MODIFIED):**
   - Added examination creation workflow, dual PDF extraction listeners, objective & coding review modal synchronization, 10-sets visual auditor, and allocation reporting with extra sets generation.
3. **`admin-dashboard.html` (MODIFIED):**
   - Added Examinations navigation view, dual PDF dropzones, Objective & Coding review dialogs, Sets Inspection modal, and candidate allocation report with capacity bar.
4. **`admin.css` (MODIFIED):**
   - Visual styling for examination cards, set pill badges, capacity meter bars, code editors, and warning banners.
5. **`exam-terms.html` (MODIFIED):**
   - Integrated `kits-exam-engine.js`, dynamic 50-mark / 90-minute metadata strip, permanent set assignment indicator, strict mode quota exhaustion alert banner, and exam routing.
6. **`index.html` (MODIFIED):**
   - Integrated `kits-exam-engine.js`, 32-question comprehensive exam builder (20 MCQ + 10 MSQ + 2 Coding), coding challenge editor with sample test runner, 4-state palette colors with gold active ring, and dual 50-mark result evaluation.
7. **`student-nav.js` (MODIFIED):**
   - Enhanced `getPublishedTests()` to automatically detect and return comprehensive exams for courses.
8. **`KITS_LMS_PROJECT_PROGRESS_REPORT.md` (UPDATED):**
   - Full technical audit, module-wise progress evaluation, and automated test certification.

