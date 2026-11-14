const fs = require('fs');
const files = [
    'admin-dashboard.html',
    'admin-login.html',
    'auth.html',
    'course-details.html',
    'courses.html',
    'dashboard.html',
    'exam-terms.html',
    'exam.html',
    'profile.html',
    'results.html'
];
files.forEach(f => {
    if (!fs.existsSync(f)) return;
    let content = fs.readFileSync(f, 'utf8');
    const orig = content;
    content = content.replace(/<!--\s*Supabase Client CDN\s*-->\s*/gi, '');
    content = content.replace(/<script\s+src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2["']><\/script>\s*/gi, '');
    content = content.replace(/Firebase Auth &amp; Supabase/g, 'Firebase Auth &amp; Firestore');
    content = content.replace(/Firebase & Supabase/g, 'Firebase');
    if (content !== orig) {
        fs.writeFileSync(f, content, 'utf8');
        console.log('Cleaned Supabase from', f);
    }
});
