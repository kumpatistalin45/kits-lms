/**
 * KITS LMS — Academic Administration Console Configuration
 * Connects to Trusted Server-Side Authentication
 * No credentials stored in client code.
 */

window.MOCKTEST_ADMIN_CONFIG = {
    sessionKey: "kits_lms_admin_session",
    authEndpoint: "/api/auth/admin-login",
    verifyEndpoint: "/api/auth/verify-session",
    allowedRoles: ["admin"]
};
