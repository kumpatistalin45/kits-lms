const path = require('path');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { FirestoreAdapter } = require('../database-adapter');

async function testConnection() {
    console.log('[TEST] Initializing FirestoreAdapter with live Firebase Admin SDK...');
    const adapter = new FirestoreAdapter();
    await adapter.init();

    const health = await adapter.healthCheck();
    console.log('[TEST] Health Check Result:', health);

    if (health.status === 'connected') {
        console.log('[SUCCESS] Successfully connected to live Firebase Cloud Firestore!');
    } else {
        console.error('[FAIL] Could not connect to live Firestore:', health);
        process.exit(1);
    }
}

testConnection().catch(err => {
    console.error('[ERROR]', err);
    process.exit(1);
});
