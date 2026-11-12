const fs = require('fs');
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

async function listServiceAccounts(token) {
    const projectId = 'kits-lms-13053';
    const url = `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`;

    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
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
        req.end();
    });
}

async function run() {
    const token = await getAccessToken();
    const res = await listServiceAccounts(token);
    console.log('[IAM] Status:', res.status);
    console.log('[IAM] Service Accounts:', JSON.stringify(res.body, null, 2));
}

run().catch(console.error);

