/**
 * KITS LMS — Production Backend Configuration
 * Single Source of Truth: Firebase Authentication, Cloud Firestore & Firebase Storage
 * Project ID: kits-lms-13053
 */

window.KITS_BACKEND_CONFIG = {
    // Firebase Web Configuration (Authentication, Firestore & Storage)
    firebase: {
        apiKey: "AIzaSyDAkkA4uKvLOj-8NF-p8okYkovKB2-a_dk",
        authDomain: "kits-lms-13053.firebaseapp.com",
        projectId: "kits-lms-13053",
        storageBucket: "kits-lms-13053.firebasestorage.app",
        messagingSenderId: "270479524994",
        appId: "1:270479524994:web:f8e416ff6098392b5ea09b",
        measurementId: "G-7NZ50H9EYC"
    },

    // Helper methods to verify live backend configuration status
    isFirebaseConfigured: function () {
        const fb = this.firebase;
        return Boolean(fb && fb.apiKey && !fb.apiKey.includes("YOUR_") && fb.projectId && !fb.projectId.includes("your-"));
    },

    isLiveConfigured: function () {
        return this.isFirebaseConfigured();
    }
};
