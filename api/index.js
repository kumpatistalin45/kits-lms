/**
 * Vercel Serverless Function Handler for KITS LMS
 * Routes all incoming /api/* calls to the pure Node.js server request handler.
 */
const requestHandler = require("../server.js");

module.exports = async (req, res) => {
    return requestHandler(req, res);
};

