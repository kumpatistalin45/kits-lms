/**
 * KITS LMS — Standard 50-MCQ Examination Question Bank & Helpers
 * 50 Questions • 50 Marks (1 mark each) • 60 Minutes Duration
 */

const DEFAULT_50_MCQS = [
    {
        question_number: 1,
        question_text: "Which of the following is an immutable built-in data type in Python?",
        option_a: "List",
        option_b: "Dictionary",
        option_c: "Tuple",
        option_d: "Set",
        correct_answer: "C"
    },
    {
        question_number: 2,
        question_text: "What will be the output of `print(type([]) is list)` in Python?",
        option_a: "True",
        option_b: "False",
        option_c: "TypeError",
        option_d: "None",
        correct_answer: "A"
    },
    {
        question_number: 3,
        question_text: "Which keyword is used to define an anonymous function in Python?",
        option_a: "def",
        option_b: "lambda",
        option_c: "func",
        option_d: "anon",
        correct_answer: "B"
    },
    {
        question_number: 4,
        question_text: "What is the time complexity of looking up a key in a Python dictionary on average?",
        option_a: "O(n)",
        option_b: "O(log n)",
        option_c: "O(1)",
        option_d: "O(n log n)",
        correct_answer: "C"
    },
    {
        question_number: 5,
        question_text: "Which module in Python is used to work with regular expressions?",
        option_a: "regex",
        option_b: "re",
        option_c: "pyregex",
        option_d: "string",
        correct_answer: "B"
    },
    {
        question_number: 6,
        question_text: "What will `bool('False')` evaluate to in Python?",
        option_a: "False",
        option_b: "True",
        option_c: "None",
        option_d: "ValueError",
        correct_answer: "B"
    },
    {
        question_number: 7,
        question_text: "Which SQL command is used to remove a table and its structure permanently?",
        option_a: "DELETE",
        option_b: "REMOVE",
        option_c: "DROP TABLE",
        option_d: "TRUNCATE",
        correct_answer: "C"
    },
    {
        question_number: 8,
        question_text: "In relational algebra, which operator is represented by the Greek letter Sigma (σ)?",
        option_a: "Projection",
        option_b: "Selection",
        option_c: "Join",
        option_d: "Cartesian product",
        correct_answer: "B"
    },
    {
        question_number: 9,
        question_text: "Which HTTP status code signifies that a requested resource was not found on the server?",
        option_a: "200",
        option_b: "403",
        option_c: "404",
        option_d: "500",
        correct_answer: "C"
    },
    {
        question_number: 10,
        question_text: "Which data structure operates on a Last-In, First-Out (LIFO) basis?",
        option_a: "Queue",
        option_b: "Stack",
        option_c: "Binary Tree",
        option_d: "Linked List",
        correct_answer: "B"
    },
    {
        question_number: 11,
        question_text: "What is the default port number for PostgreSQL database servers?",
        option_a: "3306",
        option_b: "5432",
        option_c: "27017",
        option_d: "1521",
        correct_answer: "B"
    },
    {
        question_number: 12,
        question_text: "Which method is called automatically when a new class instance is created in Python?",
        option_a: "__init__",
        option_b: "__new__",
        option_c: "__start__",
        option_d: "__construct__",
        correct_answer: "A"
    },
    {
        question_number: 13,
        question_text: "In Git, which command creates a new branch and immediately switches to it?",
        option_a: "git branch new_branch",
        option_b: "git checkout -b new_branch",
        option_c: "git switch -c new_branch",
        option_d: "Both B and C",
        correct_answer: "D"
    },
    {
        question_number: 14,
        question_text: "What does the 'A' stand for in the ACID properties of database transactions?",
        option_a: "Accuracy",
        option_b: "Atomicity",
        option_c: "Availability",
        option_d: "Authentication",
        correct_answer: "B"
    },
    {
        question_number: 15,
        question_text: "What is the result of `2 ** 3 ** 2` in Python due to right-to-left operator associativity?",
        option_a: "64",
        option_b: "512",
        option_c: "128",
        option_d: "256",
        correct_answer: "B"
    },
    {
        question_number: 16,
        question_text: "Which of the following sorting algorithms has the best worst-case time complexity?",
        option_a: "Quick Sort (O(n^2))",
        option_b: "Bubble Sort (O(n^2))",
        option_c: "Merge Sort (O(n log n))",
        option_d: "Insertion Sort (O(n^2))",
        correct_answer: "C"
    },
    {
        question_number: 17,
        question_text: "Which layer of the OSI model is responsible for end-to-end packet routing?",
        option_a: "Data Link Layer",
        option_b: "Network Layer",
        option_c: "Transport Layer",
        option_d: "Physical Layer",
        correct_answer: "B"
    },
    {
        question_number: 18,
        question_text: "What does HTML stand for in web engineering?",
        option_a: "HyperText Markup Language",
        option_b: "HighText Machine Language",
        option_c: "Hyper Transfer Markup Link",
        option_d: "Hyperlink Textual Module Language",
        correct_answer: "A"
    },
    {
        question_number: 19,
        question_text: "In Python, which built-in function returns the memory address of an object?",
        option_a: "memory()",
        option_b: "id()",
        option_c: "loc()",
        option_d: "addr()",
        correct_answer: "B"
    },
    {
        question_number: 20,
        question_text: "What does JWT stand for in web application security?",
        option_a: "Java Web Token",
        option_b: "JSON Web Token",
        option_c: "Joint Web Transmission",
        option_d: "JSON Wire Transfer",
        correct_answer: "B"
    },
    {
        question_number: 21,
        question_text: "Which protocol operates on TCP port 443 for encrypted communication?",
        option_a: "HTTP",
        option_b: "FTP",
        option_c: "HTTPS",
        option_d: "SSH",
        correct_answer: "C"
    },
    {
        question_number: 22,
        question_text: "What will `list(map(lambda x: x*2, [1, 2, 3]))` produce in Python?",
        option_a: "[1, 2, 3]",
        option_b: "[2, 4, 6]",
        option_c: "[2, 2, 2]",
        option_d: "TypeError",
        correct_answer: "B"
    },
    {
        question_number: 23,
        question_text: "In database design, what does 1NF (First Normal Form) require?",
        option_a: "No transitive dependencies",
        option_b: "Atomic values with no repeating groups",
        option_c: "No partial dependencies on primary key",
        option_d: "Multi-valued dependency resolution",
        correct_answer: "B"
    },
    {
        question_number: 24,
        question_text: "Which Python statement is used to handle exceptions gracefully?",
        option_a: "try ... except",
        option_b: "do ... catch",
        option_c: "test ... error",
        option_d: "catch ... handle",
        correct_answer: "A"
    },
    {
        question_number: 25,
        question_text: "What is the worst-case search time complexity in a balanced Binary Search Tree (AVL)?",
        option_a: "O(1)",
        option_b: "O(log n)",
        option_c: "O(n)",
        option_d: "O(n^2)",
        correct_answer: "B"
    },
    {
        question_number: 26,
        question_text: "Which parameter in Python functions allows accepting an arbitrary number of keyword arguments?",
        option_a: "*args",
        option_b: "**kwargs",
        option_c: "*vars",
        option_d: "&params",
        correct_answer: "B"
    },
    {
        question_number: 27,
        question_text: "In operating systems, which condition is NOT one of Coffman's four conditions for deadlock?",
        option_a: "Mutual Exclusion",
        option_b: "Hold and Wait",
        option_c: "Preemption Allowed",
        option_d: "Circular Wait",
        correct_answer: "C"
    },
    {
        question_number: 28,
        question_text: "What is the return type of the Python expression `{x for x in [1, 2, 2, 3]}`?",
        option_a: "List",
        option_b: "Tuple",
        option_c: "Set",
        option_d: "Dict",
        correct_answer: "C"
    },
    {
        question_number: 29,
        question_text: "Which of the following is a non-linear data structure?",
        option_a: "Array",
        option_b: "Queue",
        option_c: "Graph",
        option_d: "Stack",
        correct_answer: "C"
    },
    {
        question_number: 30,
        question_text: "In CSS, which property is used to control the space between elements' border and inner content?",
        option_a: "margin",
        option_b: "padding",
        option_c: "gap",
        option_d: "border-spacing",
        correct_answer: "B"
    },
    {
        question_number: 31,
        question_text: "What does the `pass` statement do in Python?",
        option_a: "Exits the loop",
        option_b: "Acts as a null placeholder statement",
        option_c: "Throws an exception",
        option_d: "Skips to the next function",
        correct_answer: "B"
    },
    {
        question_number: 32,
        question_text: "Which HTTP request method is idempotent and used to retrieve representation of resources?",
        option_a: "POST",
        option_b: "GET",
        option_c: "PATCH",
        option_d: "CONNECT",
        correct_answer: "B"
    },
    {
        question_number: 33,
        question_text: "What will `print('kits'.upper())` output in Python?",
        option_a: "kits",
        option_b: "KITS",
        option_c: "Kits",
        option_d: "Error",
        correct_answer: "B"
    },
    {
        question_number: 34,
        question_text: "Which algorithm is commonly used to find the shortest path from a single source node in a weighted graph?",
        option_a: "Kruskal's Algorithm",
        option_b: "Prim's Algorithm",
        option_c: "Dijkstra's Algorithm",
        option_d: "Huffman Coding",
        correct_answer: "C"
    },
    {
        question_number: 35,
        question_text: "What is the time complexity of appending an element to the end of a dynamic array (Python list) on average?",
        option_a: "O(1) amortized",
        option_b: "O(n)",
        option_c: "O(log n)",
        option_d: "O(n^2)",
        correct_answer: "A"
    },
    {
        question_number: 36,
        question_text: "Which clause in SQL is used to filter records resulting from an aggregate `GROUP BY` operation?",
        option_a: "WHERE",
        option_b: "HAVING",
        option_c: "ORDER BY",
        option_d: "FILTER",
        correct_answer: "B"
    },
    {
        question_number: 37,
        question_text: "What is the value of `len({'a': 1, 'b': 2, 'a': 3})` in Python?",
        option_a: "3",
        option_b: "2",
        option_c: "1",
        option_d: "TypeError",
        correct_answer: "B"
    },
    {
        question_number: 38,
        question_text: "Which data transmission mode permits data transmission in both directions, but only one direction at a time?",
        option_a: "Simplex",
        option_b: "Half-Duplex",
        option_c: "Full-Duplex",
        option_d: "Multiplex",
        correct_answer: "B"
    },
    {
        question_number: 39,
        question_text: "What does the `finally` block in a Python try-except-finally statement accomplish?",
        option_a: "Executes only when an exception is raised",
        option_b: "Executes only when no exception is raised",
        option_c: "Always executes regardless of whether an exception occurred",
        option_d: "Terminates the program immediately",
        correct_answer: "C"
    },
    {
        question_number: 40,
        question_text: "In Object-Oriented Programming, what is polymorphism?",
        option_a: "Hiding internal data details",
        option_b: "Ability of different classes to respond to the same method call in different ways",
        option_c: "Deriving new classes from existing classes",
        option_d: "Grouping methods and fields together",
        correct_answer: "B"
    },
    {
        question_number: 41,
        question_text: "Which Python function converts a JSON string into a Python dictionary?",
        option_a: "json.dump()",
        option_b: "json.loads()",
        option_c: "json.parse()",
        option_d: "json.stringify()",
        correct_answer: "B"
    },
    {
        question_number: 42,
        question_text: "What is the purpose of the primary key constraint in relational database tables?",
        option_a: "To allow duplicate values",
        option_b: "To uniquely identify each record and prevent NULL values",
        option_c: "To create a foreign relationship with external tables",
        option_d: "To automatically encrypt the row data",
        correct_answer: "B"
    },
    {
        question_number: 43,
        question_text: "Which of the following data structures is typically used for Breadth-First Search (BFS) in a graph?",
        option_a: "Stack",
        option_b: "Queue",
        option_c: "Binary Heap",
        option_d: "Linked List",
        correct_answer: "B"
    },
    {
        question_number: 44,
        question_text: "What does the `is` operator test in Python?",
        option_a: "Equality of values (same as ==)",
        option_b: "Identity of objects in memory (same id)",
        option_c: "Type matching",
        option_d: "Subset containment",
        correct_answer: "B"
    },
    {
        question_number: 45,
        question_text: "Which cryptographic hashing algorithm produces a 256-bit hash digest?",
        option_a: "MD5",
        option_b: "SHA-1",
        option_c: "SHA-256",
        option_d: "DES",
        correct_answer: "C"
    },
    {
        question_number: 46,
        question_text: "In Python, which keyword is used inside a function to modify a variable defined in the outer global scope?",
        option_a: "outer",
        option_b: "global",
        option_c: "extern",
        option_d: "static",
        correct_answer: "B"
    },
    {
        question_number: 47,
        question_text: "What is the primary function of DNS in computer networks?",
        option_a: "Assigning IP addresses dynamically to hosts",
        option_b: "Translating human-readable domain names to IP addresses",
        option_c: "Encrypting web packets in transit",
        option_d: "Filtering malicious incoming traffic",
        correct_answer: "B"
    },
    {
        question_number: 48,
        question_text: "Which Python slice syntax extracts elements from index 2 up to, but not including, index 5?",
        option_a: "list[2:5]",
        option_b: "list[2-5]",
        option_c: "list(2..5)",
        option_d: "list{2:5}",
        correct_answer: "A"
    },
    {
        question_number: 49,
        question_text: "What is the time complexity of binary search on a pre-sorted array of n elements?",
        option_a: "O(1)",
        option_b: "O(n)",
        option_c: "O(log n)",
        option_d: "O(n log n)",
        correct_answer: "C"
    },
    {
        question_number: 50,
        question_text: "In database management, which technique stores query results to accelerate subsequent identical queries?",
        option_a: "Normalization",
        option_b: "Caching",
        option_c: "Sharding",
        option_d: "Replication",
        correct_answer: "B"
    }
];

function sanitizeExamForStudent(exam) {
    if (!exam) return null;
    const { questions, ...safe } = exam;
    return safe;
}

function sanitizeQuestionsForStudent(questions) {
    if (!Array.isArray(questions)) return [];
    return questions.map(q => ({
        id: q.id || `q_${q.question_number}`,
        question_number: q.question_number,
        question_text: q.question_text || q.statement,
        option_a: q.option_a || (q.options && q.options[0]) || "",
        option_b: q.option_b || (q.options && q.options[1]) || "",
        option_c: q.option_c || (q.options && q.options[2]) || "",
        option_d: q.option_d || (q.options && q.options[3]) || "",
        options: [
            q.option_a || (q.options && q.options[0]) || "",
            q.option_b || (q.options && q.options[1]) || "",
            q.option_c || (q.options && q.options[2]) || "",
            q.option_d || (q.options && q.options[3]) || ""
        ]
        // Note: correct_answer is strictly omitted for student security!
    }));
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DEFAULT_50_MCQS,
        sanitizeExamForStudent,
        sanitizeQuestionsForStudent
    };
}
if (typeof window !== "undefined") {
    window.DEFAULT_50_MCQS = DEFAULT_50_MCQS;
    window.sanitizeExamForStudent = sanitizeExamForStudent;
    window.sanitizeQuestionsForStudent = sanitizeQuestionsForStudent;
}
