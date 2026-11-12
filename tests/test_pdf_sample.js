// Test PDF Question Extraction Logic
function parseQuestionsFromRawText(text) {
    if (!text || typeof text !== "string") return [];
    
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const rawQuestions = [];
    let currentQ = null;

    const qStartRegex = /^(?:Q(?:uestion)?\s*[\.:\-]?\s*|\b)(\d{1,3})[\.\:\)\-]\s*(.*)$/i;
    const ansKeyRegex = /^(?:Ans(?:wer)?|Correct\s*Ans(?:wer)?|Key)[\s\:\-\.\)]+([A-D])/i;
    const expRegex = /^(?:Explanation|Exp|Rationale)[\s\:\-\.]+(.*)$/i;
    const optLineRegex = /^(?:[\(\[]?([A-D])[\)\]\.\:\-]\s*|\b([A-D])[\.\:\)]\s+)(.*)$/i;

    function finalizeQuestion(q) {
        if (!q) return;
        
        let textLines = [];
        let rawOptions = { A: "", B: "", C: "", D: "" };
        let currentOpt = null;
        let answerKey = q.extractedAnswer || null;
        let explanationLines = q.extractedExpLines || [];
        let inExplanation = false;

        for (let i = 0; i < q.lines.length; i++) {
            const line = q.lines[i];

            // 1. Check for explanation
            const expMatch = line.match(expRegex);
            if (expMatch) {
                inExplanation = true;
                if (expMatch[1]) explanationLines.push(expMatch[1].trim());
                currentOpt = null;
                continue;
            }
            if (inExplanation) {
                explanationLines.push(line);
                continue;
            }

            // 2. Check for answer key line
            const ansMatch = line.match(ansKeyRegex);
            if (ansMatch) {
                answerKey = ansMatch[1].toUpperCase();
                currentOpt = null;
                continue;
            }

            // 3. Check for inline answer key embedded in line (e.g. "Ans: A" at end of an option or line)
            const inlineAnsMatch = line.match(/(?:Ans(?:wer)?|Key)[\s\:\-]+([A-D])\b/i);
            let cleanLine = line;
            if (inlineAnsMatch) {
                answerKey = inlineAnsMatch[1].toUpperCase();
                cleanLine = cleanLine.replace(inlineAnsMatch[0], "").trim();
            }

            // 4. Check for multiple options on a single line (e.g. "(A) Apple (B) Banana (C) Cherry (D) Date")
            const multiOptParts = cleanLine.split(/(?:[\(\[]|^|\s)([A-D])[\)\]\.\:\-]\s*/i);
            if (multiOptParts.length >= 7) { // matched at least 3-4 options
                // First part might be question text if options are on the same line as question
                if (!currentOpt && multiOptParts[0].trim()) {
                    textLines.push(multiOptParts[0].trim());
                }
                for (let k = 1; k < multiOptParts.length; k += 2) {
                    const letter = (multiOptParts[k] || "").toUpperCase();
                    const optContent = (multiOptParts[k + 1] || "").trim();
                    if (["A", "B", "C", "D"].includes(letter)) {
                        rawOptions[letter] = optContent;
                        currentOpt = letter;
                    }
                }
                continue;
            }

            // 5. Check if line starts an option (e.g. "A) Python" or "(A) Python")
            const optMatch = cleanLine.match(optLineRegex);
            if (optMatch) {
                const letter = (optMatch[1] || optMatch[2] || "").toUpperCase();
                const content = (optMatch[3] || "").trim();
                if (["A", "B", "C", "D"].includes(letter)) {
                    currentOpt = letter;
                    rawOptions[letter] = content;
                    continue;
                }
            }

            // 6. Multiline continuation
            if (currentOpt) {
                rawOptions[currentOpt] += (rawOptions[currentOpt] ? " " : "") + cleanLine;
            } else {
                textLines.push(cleanLine);
            }
        }

        const questionStatement = textLines.join(" ").replace(/\s+/g, " ").trim();
        const explanation = explanationLines.join(" ").replace(/\s+/g, " ").trim();

        // Validation
        const hasA = Boolean(rawOptions.A && rawOptions.A.trim());
        const hasB = Boolean(rawOptions.B && rawOptions.B.trim());
        const isAmbiguous = !hasA || !hasB || !questionStatement;

        rawQuestions.push({
            id: `q_${rawQuestions.length + 1}`,
            question_number: rawQuestions.length + 1,
            question_text: questionStatement || `Question ${rawQuestions.length + 1}`,
            option_a: rawOptions.A || "Option A",
            option_b: rawOptions.B || "Option B",
            option_c: rawOptions.C || "Option C",
            option_d: rawOptions.D || "Option D",
            correct_answer: answerKey || "A",
            explanation: explanation,
            marks: 1,
            needsReview: isAmbiguous,
            reviewReason: isAmbiguous ? "Incomplete options or statement detected from PDF" : ""
        });
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const qMatch = line.match(qStartRegex);

        // Check if this line is a new question
        if (qMatch) {
            // Verify it's not an option numbered like "1." inside an existing question
            // A question start must have a valid number
            if (currentQ) {
                finalizeQuestion(currentQ);
            }
            currentQ = {
                number: parseInt(qMatch[1], 10),
                lines: qMatch[2].trim() ? [qMatch[2].trim()] : [],
                extractedAnswer: null,
                extractedExpLines: []
            };
        } else if (currentQ) {
            currentQ.lines.push(line);
        }
    }

    if (currentQ) {
        finalizeQuestion(currentQ);
    }

    return rawQuestions;
}

// Verification test
const samplePdfText = `
1. What does HTML stand for?
(A) Hyper Text Markup Language
(B) High Text Machine Language
(C) Hyper Tool Markup Language
(D) Home Text Markup Language
Answer: A
Explanation: HTML is the standard markup language for documents designed to be displayed in a web browser.

2. Which of the following tags is used to create a hyperlink in HTML?
This is a multiline question statement
to verify multiline handling.
A) <link>
B) <a>
C) <href>
D) <hyper>
Ans: B
Explanation: The <a> tag defines a hyperlink.

3. Consider the following CSS rule:
body { color: red; }
What does it do?
(A) Sets text color of body to red
(B) Sets background color
(C) Both A and B
(D) None of the above
Key: A

4. Which HTTP method is idempotent? (A) POST (B) GET (C) PATCH (D) CONNECT
Answer: B
`;

const parsed = parseQuestionsFromRawText(samplePdfText);
console.log("Extracted Questions Count:", parsed.length);
console.log(JSON.stringify(parsed, null, 2));
