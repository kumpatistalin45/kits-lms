-- ============================================================================
-- KITS LMS Optional Seed Data (Development / Test Environment Only)
-- Run this script ONLY if you wish to populate initial baseline courses.
-- DO NOT RUN ON LIVE PRODUCTION WITH EXISTING DATA.
-- ============================================================================

INSERT INTO public.courses (id, title, code, description, department, instructor_name, level, duration, is_active)
VALUES
    ('entrepreneurship', 'Entrepreneurship & Venture Development', 'MGMT301', 'Learn venture formation, business model canvas, risk evaluation, and technology commercialization.', 'Management & Technology', 'Dr. K. V. Sharma', 'Intermediate', '45 Hours', TRUE),
    ('python', 'Programming in Python', 'CSE201', 'Core Python fundamentals, data structures, functional modules, and computational problem solving.', 'Computer Science & Engineering', 'Prof. S. R. Rao', 'Beginner', '40 Hours', TRUE),
    ('dbms', 'Database Management Systems', 'IT302', 'Relational modeling, SQL optimization, transactional ACID properties, concurrency control, and storage.', 'Information Technology', 'Dr. M. Lakshmi', 'Intermediate', '50 Hours', TRUE),
    ('machine-learning', 'Machine Learning & AI Principles', 'AIDS401', 'Supervised and unsupervised learning, model evaluation, neural representations, and regression models.', 'AI & Data Science', 'Prof. P. V. Ramana', 'Advanced', '45 Hours', TRUE),
    ('data-structures', 'Data Structures & Algorithms', 'CSE202', 'Complexity analysis, balanced trees, graph traversals, dynamic programming, and greedy algorithms.', 'Computer Science & Engineering', 'Dr. A. Srinivas', 'Intermediate', '60 Hours', TRUE),
    ('computer-networks', 'Computer Networks & Security', 'ECE305', 'OSI and TCP/IP stack, routing protocols, subnetting, transport layer flow control, and cryptography.', 'Electronics & Communication', 'Prof. N. Chaitanya', 'Intermediate', '40 Hours', TRUE)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    instructor_name = EXCLUDED.instructor_name;

