import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { MongoClient, ServerApiVersion } from "mongodb";
import ollama from "ollama";
import fs from "fs/promises";

// Connection string for MongoDB
const URI = `mongodb+srv://swaminathanchellappa5_db_user:${process.env.MONGO_DB_PASSWORD}@aiinboxassistant.va82mrt.mongodb.net/?retryWrites=true&w=majority&appName=AIInboxAssistant`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//UserEmailsData Database
const database = client.db("UserEmailsData");
//Emails collection
const emailsCollection = database.collection("Emails");

// The scope for reading Gmail labels.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
// The path to the credentials file.
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
// Authenticate with Google and get an authorized client
const auth = await authenticate({
  scopes: SCOPES,
  keyfilePath: CREDENTIALS_PATH,
});

// Create a new Gmail API client
const gmail = google.gmail({ version: "v1", auth });

const app = express();

app.use(cors());
app.use(express.json());

async function fetchEmails() {
  let messages_list = [];
  // Get the list of emails
  const result = await gmail.users.messages.list({ userId: "me" });
  const messages = result.data.messages;
  if (!messages || messages.length === 0) {
    console.log("No emails found.");
    return;
  }

  console.log("Emails:");

  // Helper to extract body text from a message payload
  function extractBody(payload) {
    if (!payload) return "";
    // If body is directly present
    if (payload.body && payload.body.data) {
      try {
        return Buffer.from(payload.body.data, "base64").toString("utf8");
      } catch (e) {
        return "";
      }
    }
    // If message has parts, try to find a text/plain
    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body && part.body.data) {
          try {
            return Buffer.from(part.body.data, "base64").toString("utf8");
          } catch (e) {
            return "";
          }
        }
        // recurse into nested parts
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
    return "";
  }

  // For each message ID returned by messages.list we need to fetch the full message
  for (const m of messages) {
    try {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "full",
      });
      const data = msg.data;
      var internalDate = new Date(data.internalDate * 1000);
      const sentOnDate = new Date(parseInt(data.internalDate)).toDateString()
      const headers = (data.payload && data.payload.headers) || [];
      const getHeader = (name) => {
        const h = headers.find(
          (hh) => hh.name && hh.name.toLowerCase() === name.toLowerCase()
        );
        return h ? h.value : undefined;
      };
      const bodyText = extractBody(data.payload);
      const emailJson = {
        sentOnDate: sentOnDate,
        subject: getHeader("Subject") || "<no-subject>",
        content: extractBody(data.payload) || "<empty>"
      };
      const priorityObj = await llmInference(emailJson, process.env.PRIORITY_CLASSIFICATION_PROMPT_FILEPATH)
      const email_obj = {
        rawEmail: {
          id: data.id,
          threadId: data.threadId,
          date: sentOnDate,
          subject: getHeader("Subject") || "<no-subject>",
          sender: getHeader("From") || "<unknown>",
          body: extractBody(data.payload) || "<empty>",
        },
        priority: priorityObj.priority,
        category: [],
        userTopics: [],
      };

      if (messages_list.length > 10) {
        console.log("Collected 10 emails");
        const response = await push2DB(emailsCollection, messages_list);
        messages_list = [];
      }
      messages_list.push(email_obj);
    } catch (err) {
      console.error(
        "Failed to fetch full message for id",
        m.id,
        err.message || err
      );
    }
  }
}

async function push2DB(collection, emails) {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
    const result = await collection.insertMany(emails);
    console.log("Pushed 10 records to the DB");
    return "Success";
  } catch (error) {
    console.log("Error pushing records to the DB");
    console.error(error);
    return "Failed";
  } finally {
    await client.close();
  }
}

async function loadSystemPrompt(fileName) {
  try {
    const data = await fs.readFile(fileName, "utf8");
    if (!data || data.length === 0) {
      console.error("The system prompt is empty");
    }
    return data;
  } catch (err) {
    console.error(`Error reading system prompt from ${fileName}:`, err);
    return "";
  }
}

async function llmInference(messageObj, sysPromptFName) {
  let systemPrompt = await loadSystemPrompt(sysPromptFName);

  const response = await ollama.chat({
    model: "mistral:latest",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(messageObj)},
    ]
  });
  try{
    return JSON.parse(response.message.content);
  }catch{
    console.error("Could not parse model response, defaulting to medium priority");
    return {priority: "medium"};
  }
  
}

// Helper endpoint for to reset the DB completely
app.post("/delete", async (req, res) => {
  try {
    const response = await emailsCollection.deleteMany({});
    res.json({ message: "Deleted all records in MongoDB" });
  } catch (error) {
    res.json({ message: `Error deleting all records in MongoDB:\n ${error}` });
  }
});

// Simple health route
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// GET /fetchEmails
app.get("/fetchEmails", async (req, res) => {
  console.log('Hello from the "fetchEmails" endpoint!');
  const resp = await fetchEmails();
  //console.log(resp);
  res.json({ message: "fetchEmails received" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});
