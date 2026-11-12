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
                if (json.access_token) {
                    resolve(json.access_token);
                } else {
                    reject(new Error(JSON.stringify(json)));
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function enableService(accessToken, service) {
    const projectId = 'kits-lms-13053';
    const url = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${service}:enable`;

    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Length': 0
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, body: json });
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
    console.log('[AUTH] Refreshing access token...');
    const token = await getAccessToken();
    console.log('[AUTH] Token refreshed successfully.');

    console.log('[API] Enabling firestore.googleapis.com for kits-lms-13053...');
    const res = await enableService(token, 'firestore.googleapis.com');
    console.log('[API] Response status:', res.status);
    console.log('[API] Response body:', JSON.stringify(res.body, null, 2));
}

run().catch(err => {
    console.error('[ERROR]', err);
    process.exit(1);
});
