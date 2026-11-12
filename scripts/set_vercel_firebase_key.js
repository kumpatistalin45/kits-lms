const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const keyPath = path.join(__dirname, '..', 'firebase-adminsdk-kits-lms-13053.json');
if (!fs.existsSync(keyPath)) {
    console.error('Key file not found at:', keyPath);
    process.exit(1);
}

const keyContent = fs.readFileSync(keyPath, 'utf-8').trim();
console.log('[VERCEL-ENV] Setting FIREBASE_SERVICE_ACCOUNT_KEY on Vercel...');

execSync('npx vercel env add FIREBASE_SERVICE_ACCOUNT_KEY --environment production,preview,development --force --yes', {
    input: keyContent,
    stdio: ['pipe', 'inherit', 'inherit']
});

console.log('[VERCEL-ENV] Successfully configured FIREBASE_SERVICE_ACCOUNT_KEY on Vercel!');
