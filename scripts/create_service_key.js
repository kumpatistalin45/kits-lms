const fs = require('fs');
const path = require('path');
const https = require('https');

async function getAccessToken() {
    const configPath = 'C:\\Users\\JAYA CHANDRA KUMPATI\\.config\\configstore\\firebase-tools.json';
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const refreshToken = config.tokens.refresh_token;

    const postData = new URLSearchParams({
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    }).toString();

    return new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const json = JSON.parse(data);
                if (json.access_token) resolve(json.access_token);
                else reject(new Error(JSON.stringify(json)));
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function createServiceAccountKey(token) {
    const saEmail = 'firebase-adminsdk-fbsvc@kits-lms-13053.iam.gserviceaccount.com';
    const url = `https://iam.googleapis.com/v1/projects/kits-lms-13053/serviceAccounts/${saEmail}/keys`;

    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify({ privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE' }));
        req.end();
    });
}

async function run() {
    console.log('[KEY-GEN] Authenticating...');
    const token = await getAccessToken();
    console.log('[KEY-GEN] Creating service account key for Firebase Admin SDK...');
    const res = await createServiceAccountKey(token);

    if (res.status === 200 && res.body.privateKeyData) {
        const decoded = Buffer.from(res.body.privateKeyData, 'base64').toString('utf-8');
        const keyFilePath = path.join(__dirname, '..', 'firebase-adminsdk-kits-lms-13053.json');
        fs.writeFileSync(keyFilePath, decoded, 'utf-8');
        console.log(`[KEY-GEN] Key successfully generated and saved to: ${keyFilePath}`);

        // Update .env with FIREBASE_SERVICE_ACCOUNT_KEY
        const envPath = path.join(__dirname, '..', '.env');
        let envContent = fs.readFileSync(envPath, 'utf-8');
        if (!envContent.includes('FIREBASE_SERVICE_ACCOUNT_KEY=')) {
            envContent += `\nFIREBASE_SERVICE_ACCOUNT_KEY="${keyFilePath.replace(/\\/g, '\\\\')}"\n`;
            fs.writeFileSync(envPath, envContent, 'utf-8');
            console.log('[KEY-GEN] .env updated with FIREBASE_SERVICE_ACCOUNT_KEY.');
        }
    } else {
        console.error('[KEY-GEN-FAIL] Status:', res.status, res.body);
        process.exit(1);
    }
}

run().catch(console.error);
