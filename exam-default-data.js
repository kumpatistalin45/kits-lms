/**
 * KITS LMS — Standard 50-MCQ Examination Question Bank & Helpers
 * 50 Questions • 50 Marks (1 mark each) • 60 Minutes Duration
 * Comprehensive Master Question Bank with Verified Academic Explanations
 */

const DEFAULT_50_MCQS = [
    {
        question_number: 1,
        question_text: "Which of the following is an immutable built-in data type in Python?",
        option_a: "List",
        option_b: "Dictionary",
        option_c: "Tuple",
        option_d: "Set",
        correct_answer: "C",
        explanation: "In Python, tuples, strings, and integers are immutable data types whose values cannot be changed in place after creation, unlike lists, sets, and dictionaries which are mutable."
    },
    {
        question_number: 2,
        question_text: "What will be the output of `print(type([]) is list)` in Python?",
        option_a: "True",
        option_b: "False",
        option_c: "TypeError",
        option_d: "None",
        correct_answer: "A",
        explanation: "`type([])` returns the built-in `list` class. In Python, comparing `type([]) is list` evaluates to `True` because both refer to the exact same type object in memory."
    },
    {
        question_number: 3,
        question_text: "Which keyword is used to define an anonymous function in Python?",
        option_a: "def",
        option_b: "lambda",
        option_c: "func",
        option_d: "anon",
        correct_answer: "B",
        explanation: "The `lambda` keyword in Python is specifically used to declare small, anonymous inline functions that can take any number of arguments but contain only a single expression."
    },
    {
        question_number: 4,
        question_text: "What is the time complexity of looking up a key in a Python dictionary on average?",
        option_a: "O(n)",
        option_b: "O(log n)",
        option_c: "O(1)",
        option_d: "O(n log n)",
        correct_answer: "C",
        explanation: "Python dictionaries use a hash table implementation where key lookup, insertion, and deletion operate in average-case O(1) constant time complexity."
    },
    {
        question_number: 5,
        question_text: "Which module in Python is used to work with regular expressions?",
        option_a: "regex",
        option_b: "re",
        option_c: "pyregex",
        option_d: "string",
        correct_answer: "B",
        explanation: "The `re` module provides regular expression matching operations in Python's standard library."
    },
    {
        question_number: 6,
        question_text: "What will `bool('False')` evaluate to in Python?",
        option_a: "False",
        option_b: "True",
        option_c: "None",
        option_d: "ValueError",
        correct_answer: "B",
        explanation: "In Python, any non-empty string evaluates to `True` in a boolean context, so `bool('False')` is `True` because the string contains characters."
    },
    {
        question_number: 7,
        question_text: "Which SQL command is used to remove a table and its structure permanently?",
        option_a: "DELETE",
        option_b: "REMOVE",
        option_c: "DROP TABLE",
        option_d: "TRUNCATE",
        correct_answer: "C",
        explanation: "The `DROP TABLE` command is a Data Definition Language (DDL) operation that removes the table definition, its data, indexes, constraints, and triggers permanently from the database schema."
    },
    {
        question_number: 8,
        question_text: "In relational algebra, which operator is represented by the Greek letter Sigma (σ)?",
        option_a: "Projection",
        option_b: "Selection",
        option_c: "Join",
        option_d: "Cartesian product",
        correct_answer: "B",
        explanation: "In relational algebra, the Greek letter Sigma (σ) denotes the Selection operation, which filters rows that satisfy a specified predicate condition."
    },
    {
        question_number: 9,
        question_text: "Which HTTP status code signifies that a requested resource was not found on the server?",
        option_a: "200",
        option_b: "403",
        option_c: "404",
        option_d: "500",
        correct_answer: "C",
        explanation: "HTTP Status Code 404 Not Found indicates that the server cannot locate the requested resource at the specified URI."
    },
    {
        question_number: 10,
        question_text: "Which data structure operates on a Last-In, First-Out (LIFO) basis?",
        option_a: "Queue",
        option_b: "Stack",
        option_c: "Binary Tree",
        option_d: "Linked List",
        correct_answer: "B",
        explanation: "A Stack is a linear data structure that follows the Last-In, First-Out (LIFO) principle, where the most recently added element is removed first."
    },
    {
        question_number: 11,
        question_text: "What is the default port number for PostgreSQL database servers?",
        option_a: "3306",
        option_b: "5432",
        option_c: "27017",
        option_d: "1521",
        correct_answer: "B",
        explanation: "Port 5432 is the standard default listening port assigned by IANA for PostgreSQL database service connections."
    },
    {
        question_number: 12,
        question_text: "Which method is called automatically when a new class instance is created in Python?",
        option_a: "__init__",
        option_b: "__new__",
        option_c: "__start__",
        option_d: "__construct__",
        correct_answer: "A",
        explanation: "The `__init__` method serves as the constructor/initializer in Python classes, invoked automatically when a new instance is instantiated."
    },
    {
        question_number: 13,
        question_text: "In Git, which command creates a new branch and immediately switches to it?",
        option_a: "git branch new_branch",
        option_b: "git checkout -b new_branch",
        option_c: "git switch -c new_branch",
        option_d: "Both B and C",
        correct_answer: "D",
        explanation: "Both `git checkout -b <branch>` and the modern `git switch -c <branch>` create a new branch and immediately switch HEAD to it."
    },
    {
        question_number: 14,
        question_text: "What does the 'A' stand for in the ACID properties of database transactions?",
        option_a: "Accuracy",
        option_b: "Atomicity",
        option_c: "Availability",
        option_d: "Authentication",
        correct_answer: "B",
        explanation: "In ACID transaction properties, Atomicity ensures all operations within a transaction succeed completely or none are executed (all-or-nothing guarantee)."
    },
    {
        question_number: 15,
        question_text: "What is the result of `2 ** 3 ** 2` in Python due to right-to-left operator associativity?",
        option_a: "64",
        option_b: "512",
        option_c: "128",
        option_d: "256",
        correct_answer: "B",
        explanation: "In Python, the exponentiation operator `**` has right-to-left associativity. Thus `2 ** 3 ** 2` is evaluated as `2 ** (3 ** 2) = 2 ** 9 = 512`."
    },
    {
        question_number: 16,
        question_text: "Which of the following sorting algorithms has the best worst-case time complexity?",
        option_a: "Quick Sort (O(n^2))",
        option_b: "Bubble Sort (O(n^2))",
        option_c: "Merge Sort (O(n log n))",
        option_d: "Insertion Sort (O(n^2))",
        correct_answer: "C",
        explanation: "Merge Sort guarantees an optimal worst-case time complexity of O(n log n) by using the divide-and-conquer paradigm, whereas Quick Sort, Bubble Sort, and Insertion Sort degrade to O(n^2) in their worst cases."
    },
    {
        question_number: 17,
        question_text: "Which layer of the OSI model is responsible for end-to-end packet routing?",
        option_a: "Data Link Layer",
        option_b: "Network Layer",
        option_c: "Transport Layer",
        option_d: "Physical Layer",
        correct_answer: "B",
        explanation: "The Network Layer (Layer 3) of the OSI model handles logical addressing (IP addresses) and packet routing across intermediate routers from source to destination."
    },
    {
        question_number: 18,
        question_text: "What does HTML stand for in web engineering?",
        option_a: "HyperText Markup Language",
        option_b: "HighText Machine Language",
        option_c: "Hyper Transfer Markup Link",
        option_d: "Hyperlink Textual Module Language",
        correct_answer: "A",
        explanation: "HTML stands for HyperText Markup Language, the standard markup language used to structure web pages and their content."
    },
    {
        question_number: 19,
        question_text: "In Python, which built-in function returns the memory address of an object?",
        option_a: "memory()",
        option_b: "id()",
        option_c: "loc()",
        option_d: "addr()",
        correct_answer: "B",
        explanation: "The `id()` function in Python returns the unique identity of an object, which is represented by its memory address in CPython."
    },
    {
        question_number: 20,
        question_text: "What does JWT stand for in web application security?",
        option_a: "Java Web Token",
        option_b: "JSON Web Token",
        option_c: "Joint Web Transmission",
        option_d: "JSON Wire Transfer",
        correct_answer: "B",
        explanation: "JWT stands for JSON Web Token, a compact, URL-safe means of representing claims securely transmitted between two parties."
    },
    {
        question_number: 21,
        question_text: "Which protocol operates on TCP port 443 for encrypted communication?",
        option_a: "HTTP",
        option_b: "FTP",
        option_c: "HTTPS",
        option_d: "SSH",
        correct_answer: "C",
        explanation: "Port 443 is the standard TCP port allocated for HTTPS (Hypertext Transfer Protocol Secure) utilizing TLS/SSL encryption."
    },
    {
        question_number: 22,
        question_text: "What will `list(map(lambda x: x*2, [1, 2, 3]))` produce in Python?",
        option_a: "[1, 2, 3]",
        option_b: "[2, 4, 6]",
        option_c: "[2, 2, 2]",
        option_d: "TypeError",
        correct_answer: "B",
        explanation: "The `map()` function applies the `lambda x: x*2` function to each element `[1, 2, 3]`, yielding `[2, 4, 6]`."
    },
    {
        question_number: 23,
        question_text: "In database design, what does 1NF (First Normal Form) require?",
        option_a: "No transitive dependencies",
        option_b: "Atomic values with no repeating groups",
        option_c: "No partial dependencies on primary key",
        option_d: "Multi-valued dependency resolution",
        correct_answer: "B",
        explanation: "First Normal Form (1NF) mandates that every table column contains atomic (indivisible) values and that there are no repeating groups or arrays."
    },
    {
        question_number: 24,
        question_text: "Which Python statement is used to handle exceptions gracefully?",
        option_a: "try ... except",
        option_b: "do ... catch",
        option_c: "test ... error",
        option_d: "catch ... handle",
        correct_answer: "A",
        explanation: "In Python, structured exception handling is implemented using the `try ... except ... else ... finally` construct."
    },
    {
        question_number: 25,
        question_text: "What is the worst-case search time complexity in a balanced Binary Search Tree (AVL)?",
        option_a: "O(1)",
        option_b: "O(log n)",
        option_c: "O(n)",
        option_d: "O(n^2)",
        correct_answer: "B",
        explanation: "In a balanced Binary Search Tree such as an AVL tree, tree height is strictly maintained at O(log n), guaranteeing O(log n) worst-case search time."
    },
    {
        question_number: 26,
        question_text: "Which parameter in Python functions allows accepting an arbitrary number of keyword arguments?",
        option_a: "*args",
        option_b: "**kwargs",
        option_c: "*vars",
        option_d: "&params",
        correct_answer: "B",
        explanation: "`**kwargs` in a Python function definition unpacks an arbitrary number of keyword (named) arguments into a dictionary."
    },
    {
        question_number: 27,
        question_text: "In operating systems, which condition is NOT one of Coffman's four conditions for deadlock?",
        option_a: "Mutual Exclusion",
        option_b: "Hold and Wait",
        option_c: "Preemption Allowed",
        option_d: "Circular Wait",
        correct_answer: "C",
        explanation: "Coffman's four deadlock conditions are Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. 'Preemption Allowed' prevents deadlock rather than causing it."
    },
    {
        question_number: 28,
        question_text: "What is the return type of the Python expression `{x for x in [1, 2, 2, 3]}`?",
        option_a: "List",
        option_b: "Tuple",
        option_c: "Set",
        option_d: "Dict",
        correct_answer: "C",
        explanation: "The expression `{x for x in [1, 2, 2, 3]}` is a set comprehension, which returns a `set` containing unique elements `{1, 2, 3}`."
    },
    {
        question_number: 29,
        question_text: "Which of the following is a non-linear data structure?",
        option_a: "Array",
        option_b: "Queue",
        option_c: "Graph",
        option_d: "Stack",
        correct_answer: "C",
        explanation: "A Graph consists of vertices and edges that form non-hierarchical, non-sequential relationships, classifying it as a non-linear data structure."
    },
    {
        question_number: 30,
        question_text: "In CSS, which property is used to control the space between elements' border and inner content?",
        option_a: "margin",
        option_b: "padding",
        option_c: "gap",
        option_d: "border-spacing",
        correct_answer: "B",
        explanation: "The CSS `padding` property sets the space between the content of an element and its border."
    },
    {
        question_number: 31,
        question_text: "What does the `pass` statement do in Python?",
        option_a: "Exits the loop",
        option_b: "Acts as a null placeholder statement",
        option_c: "Throws an exception",
        option_d: "Skips to the next function",
        correct_answer: "B",
        explanation: "In Python, `pass` is a null statement used as a syntactic placeholder where code is syntactically required but no action is taken."
    },
    {
        question_number: 32,
        question_text: "Which HTTP request method is idempotent and used to retrieve representation of resources?",
        option_a: "POST",
        option_b: "GET",
        option_c: "PATCH",
        option_d: "CONNECT",
        correct_answer: "B",
        explanation: "The HTTP `GET` method is safe and idempotent, used strictly to request a representation of a specified resource without causing server-side side effects."
    },
    {
        question_number: 33,
        question_text: "What will `print('kits'.upper())` output in Python?",
        option_a: "kits",
        option_b: "KITS",
        option_c: "Kits",
        option_d: "Error",
        correct_answer: "B",
        explanation: "The `.upper()` method on string `'kits'` converts all lowercase characters to uppercase, returning `'KITS'`."
    },
    {
        question_number: 34,
        question_text: "Which algorithm is commonly used to find the shortest path from a single source node in a weighted graph?",
        option_a: "Kruskal's Algorithm",
        option_b: "Prim's Algorithm",
        option_c: "Dijkstra's Algorithm",
        option_d: "Huffman Coding",
        correct_answer: "C",
        explanation: "Dijkstra's Algorithm finds the shortest path from a single source node to all other nodes in a weighted graph with non-negative edge weights."
    },
    {
        question_number: 35,
        question_text: "What is the time complexity of appending an element to the end of a dynamic array (Python list) on average?",
        option_a: "O(1) amortized",
        option_b: "O(n)",
        option_c: "O(log n)",
        option_d: "O(n^2)",
        correct_answer: "A",
        explanation: "Dynamic arrays (Python lists) allocate extra capacity upon resizing, resulting in an amortized O(1) time complexity for `append()` operations."
    },
    {
        question_number: 36,
        question_text: "Which clause in SQL is used to filter records resulting from an aggregate `GROUP BY` operation?",
        option_a: "WHERE",
        option_b: "HAVING",
        option_c: "ORDER BY",
        option_d: "FILTER",
        correct_answer: "B",
        explanation: "The `HAVING` clause is used in SQL to filter grouped rows created by `GROUP BY` based on aggregate conditions (e.g. `HAVING COUNT(*) > 1`)."
    },
    {
        question_number: 37,
        question_text: "What is the value of `len({'a': 1, 'b': 2, 'a': 3})` in Python?",
        option_a: "3",
        option_b: "2",
        option_c: "1",
        option_d: "TypeError",
        correct_answer: "B",
        explanation: "In Python dictionary literals with duplicate keys, later key-value pairs overwrite earlier ones. Here `'a': 3` overwrites `'a': 1`, yielding `{'a': 3, 'b': 2}` with length 2."
    },
    {
        question_number: 38,
        question_text: "Which data transmission mode permits data transmission in both directions, but only one direction at a time?",
        option_a: "Simplex",
        option_b: "Half-Duplex",
        option_c: "Full-Duplex",
        option_d: "Multiplex",
        correct_answer: "B",
        explanation: "Half-Duplex mode permits bidirectional data transmission between two stations, but only in one direction at a time (e.g., walkie-talkies)."
    },
    {
        question_number: 39,
        question_text: "What does the `finally` block in a Python try-except-finally statement accomplish?",
        option_a: "Executes only when an exception is raised",
        option_b: "Executes only when no exception is raised",
        option_c: "Always executes regardless of whether an exception occurred",
        option_d: "Terminates the program immediately",
        correct_answer: "C",
        explanation: "The `finally` clause always executes upon exiting the try-except statement, regardless of whether an exception occurred, was handled, or was raised."
    },
    {
        question_number: 40,
        question_text: "In Object-Oriented Programming, what is polymorphism?",
        option_a: "Hiding internal data details",
        option_b: "Ability of different classes to respond to the same method call in different ways",
        option_c: "Deriving new classes from existing classes",
        option_d: "Grouping methods and fields together",
        correct_answer: "B",
        explanation: "Polymorphism enables objects of different classes to be treated through a common interface, each executing its own type-specific implementation."
    },
    {
        question_number: 41,
        question_text: "Which Python function converts a JSON string into a Python dictionary?",
        option_a: "json.dump()",
        option_b: "json.loads()",
        option_c: "json.parse()",
        option_d: "json.stringify()",
        correct_answer: "B",
        explanation: "`json.loads()` (load string) deserializes a JSON-formatted string into corresponding Python data structures such as dicts or lists."
    },
    {
        question_number: 42,
        question_text: "What is the purpose of the primary key constraint in relational database tables?",
        option_a: "To allow duplicate values",
        option_b: "To uniquely identify each record and prevent NULL values",
        option_c: "To create a foreign relationship with external tables",
        option_d: "To automatically encrypt the row data",
        correct_answer: "B",
        explanation: "A Primary Key constraint enforces entity integrity by uniquely identifying each row in a table and prohibiting NULL values."
    },
    {
        question_number: 43,
        question_text: "Which of the following data structures is typically used for Breadth-First Search (BFS) in a graph?",
        option_a: "Stack",
        option_b: "Queue",
        option_c: "Binary Heap",
        option_d: "Linked List",
        correct_answer: "B",
        explanation: "Breadth-First Search (BFS) explores vertices layer by layer in order of their distance from the source, using a First-In, First-Out (FIFO) Queue."
    },
    {
        question_number: 44,
        question_text: "What does the `is` operator test in Python?",
        option_a: "Equality of values (same as ==)",
        option_b: "Identity of objects in memory (same id)",
        option_c: "Type matching",
        option_d: "Subset containment",
        correct_answer: "B",
        explanation: "The `is` keyword in Python tests for identity, checking if two variables reference the exact same object in memory (`id(a) == id(b)`)."
    },
    {
        question_number: 45,
        question_text: "Which cryptographic hashing algorithm produces a 256-bit hash digest?",
        option_a: "MD5",
        option_b: "SHA-1",
        option_c: "SHA-256",
        option_d: "DES",
        correct_answer: "C",
        explanation: "SHA-256 (Secure Hash Algorithm 256-bit) is a cryptographic hash function in the SHA-2 family that produces a fixed 256-bit (32-byte) message digest."
    },
    {
        question_number: 46,
        question_text: "In Python, which keyword is used inside a function to modify a variable defined in the outer global scope?",
        option_a: "outer",
        option_b: "global",
        option_c: "extern",
        option_d: "static",
        correct_answer: "B",
        explanation: "The `global` keyword inside a function informs Python that a variable name refers to a variable in the global namespace rather than creating a local variable."
    },
    {
        question_number: 47,
        question_text: "What is the primary function of DNS in computer networks?",
        option_a: "Assigning IP addresses dynamically to hosts",
        option_b: "Translating human-readable domain names to IP addresses",
        option_c: "Encrypting web packets in transit",
        option_d: "Filtering malicious incoming traffic",
        correct_answer: "B",
        explanation: "DNS (Domain Name System) functions as the Internet's phonebook, translating human-friendly domain names (e.g., example.com) into machine-routable IP addresses."
    },
    {
        question_number: 48,
        question_text: "Which Python slice syntax extracts elements from index 2 up to, but not including, index 5?",
        option_a: "list[2:5]",
        option_b: "list[2-5]",
        option_c: "list(2..5)",
        option_d: "list{2:5}",
        correct_answer: "A",
        explanation: "Python slice notation `list[start:stop]` includes the element at index `start` up to, but not including, index `stop`. Hence `list[2:5]` extracts indices 2, 3, and 4."
    },
    {
        question_number: 49,
        question_text: "What is the time complexity of binary search on a pre-sorted array of n elements?",
        option_a: "O(1)",
        option_b: "O(n)",
        option_c: "O(log n)",
        option_d: "O(n log n)",
        correct_answer: "C",
        explanation: "Binary search repeatedly divides a sorted search interval in half, achieving an efficient logarithmic time complexity of O(log n)."
    },
    {
        question_number: 50,
        question_text: "In database management, which technique stores query results to accelerate subsequent identical queries?",
        option_a: "Normalization",
        option_b: "Caching",
        option_c: "Sharding",
        option_d: "Replication",
        correct_answer: "B",
        explanation: "Caching is the performance optimization technique of temporarily storing computed query results in high-speed memory to serve subsequent identical requests quickly."
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
        statement: q.question_text || q.statement,
        type: q.type || "mcq",
        marks: q.marks || 1,
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
        // Note: correct_answer & explanation are strictly stripped during exam execution!
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
