/**
 * Vercel Serverless Function Catch-All Handler for KITS LMS
 * Automatically matches all /api/* requests
 */
const requestHandler = require("../server.js");

module.exports = async (req, res) => {
    return requestHandler(req, res);
};
