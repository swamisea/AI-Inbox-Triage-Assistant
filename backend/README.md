# Backend (AI-Inbox-Triage-Assistant)

This is a minimal Express backend used during development.

Prerequisites
- Node.js 18+ (or compatible)
- npm

Install

```bash
cd backend
npm install
```

Run

```bash
# start with nodemon (already in package.json scripts)
npm start

# or run directly
node server.js
```

Test the endpoint

```bash
# health check
curl http://localhost:3000/

# call fetchEmails (POST)
curl -X POST http://localhost:3000/fetchEmails -H "Content-Type: application/json" -d '{}'
```

Expected behavior
- The server will log `Hello there` to the console when `/fetchEmails` is called.
- The endpoint responds with `{"message":"fetchEmails received"}`.
