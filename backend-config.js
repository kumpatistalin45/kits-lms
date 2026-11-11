/**
 * KITS LMS — Production Backend Configuration
 * Connects Firebase Authentication and Supabase PostgreSQL Database & Storage
 *
 * INSTRUCTIONS:
 * 1. For Firebase Auth:
 *    - Create a Firebase Project at https://console.firebase.google.com/
 *    - Enable "Email/Password" sign-in provider in Authentication > Sign-in method.
 *    - Copy your Web App config credentials into the `firebase` object below.
 *
 * 2. For Supabase Database & Storage:
 *    - Create a Supabase project at https://supabase.com/
 *    - In the SQL Editor, execute the schema provided in `supabase-schema.sql`.
 *    - Copy your Project URL and anon public API key into the `supabase` object below.
 */

window.KITS_BACKEND_CONFIG = {
    // Firebase Web Configuration (Authentication & Analytics)
    firebase: {
        apiKey: "AIzaSyDAkkA4uKvLOj-8NF-p8okYkovKB2-a_dk",
        authDomain: "kits-lms-13053.firebaseapp.com",
        projectId: "kits-lms-13053",
        storageBucket: "kits-lms-13053.firebasestorage.app",
        messagingSenderId: "270479524994",
        appId: "1:270479524994:web:f8e416ff6098392b5ea09b",
        measurementId: "G-7NZ50H9EYC"
    },

    // Supabase Configuration (PostgreSQL Database & Private Storage)
    supabase: {
        url: "https://suumbnmnkmedfuzijlmu.supabase.co",
        anonKey: "sb_publishable_PCefe301dmMEPFcv9nBWvg_7HtgsXHx",
        examBucket: "exam-papers"
    },

    // Helper methods to verify live backend configuration status
    isFirebaseConfigured: function () {
        const fb = this.firebase;
        return Boolean(fb && fb.apiKey && !fb.apiKey.includes("YOUR_") && fb.projectId && !fb.projectId.includes("your-"));
    },

    isSupabaseConfigured: function () {
        const sb = this.supabase;
        return Boolean(sb && sb.url && !sb.url.includes("your-") && sb.anonKey && !sb.anonKey.includes("YOUR_"));
    },

    isLiveConfigured: function () {
        return this.isFirebaseConfigured() && this.isSupabaseConfigured();
    }
};

