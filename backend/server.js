import express from 'express';
import cors from 'cors';
import path from 'node:path';
import process from 'node:process';
import {authenticate} from '@google-cloud/local-auth';
import {google} from 'googleapis';

// The scope for reading Gmail labels.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The path to the credentials file.
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const app = express();

app.use(cors());
app.use(express.json());

async function fetchEmails() {
  // Authenticate with Google and get an authorized client
  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  // Create a new Gmail API client
  const gmail = google.gmail({version: 'v1', auth});
  // Get the list of emails
  const result = await gmail.users.messages.list({ userId: 'me' });
  const messages = result.data.messages;
  if (!messages || messages.length === 0) {
    console.log('No emails found.');
    return;
  }

  console.log('Emails:');

  // Helper to extract body text from a message payload
  function extractBody(payload) {
    if (!payload) return '';
    // If body is directly present
    if (payload.body && payload.body.data) {
      try {
        return Buffer.from(payload.body.data, 'base64').toString('utf8');
      } catch (e) {
        return '';
      }
    }
    // If message has parts, try to find a text/plain
    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          try {
            return Buffer.from(part.body.data, 'base64').toString('utf8');
          } catch (e) {
            return '';
          }
        }
        // recurse into nested parts
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
    return '';
  }

  // For each message ID returned by messages.list we need to fetch the full message
  for (const m of messages) {
    try {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const data = msg.data;
      console.log(`- id: ${data.id}`);
      console.log(`-- threadId: ${data.threadId}`);
      var internalDate = new Date(data.internalDate*1000);
      console.log(`-- internalDate: ${internalDate.toDateString()}`);

      const headers = (data.payload && data.payload.headers) || [];
      const getHeader = (name) => {
        const h = headers.find((hh) => hh.name && hh.name.toLowerCase() === name.toLowerCase());
        return h ? h.value : undefined;
      };

      console.log(`-- Subject: ${getHeader('Subject') || '<no-subject>'}`);
      console.log(`-- From: ${getHeader('From') || '<unknown>'}`);
      console.log(`-- Date: ${getHeader('Date') || '<no-date>'}`);

      const bodyText = extractBody(data.payload);
      console.log(`-- Body (snippet): ${bodyText ? bodyText : '<empty>'}`);
      console.log('----------------------');
    } catch (err) {
      console.error('Failed to fetch full message for id', m.id, err.message || err);
    }
  }
}



// Simple health route
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// GET /fetchEmails 
app.get("/fetchEmails", async (req, res) => {
  console.log("Hello there");
  const resp = await fetchEmails();
  console.log(resp)
  res.json({ message: "fetchEmails received" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});
