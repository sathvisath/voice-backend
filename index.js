import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Claude
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// System prompt that teaches Claude about the business app
const SYSTEM_PROMPT = `You are a voice assistant for a solo business management app used by plumbers, electricians, cleaners, contractors, and other service professionals.

Your job is to understand voice commands and extract structured data for these operations:

1. APPOINTMENTS - schedule, view, update appointments
2. INVOICES - create, view invoices
3. CONTRACTS - generate contracts
4. EXPENSES - track business expenses
5. CLIENTS - manage client information
6. CALENDAR - check schedule, availability
7. ACCOUNTING - view revenue, expenses, summaries

When you receive a voice command, respond with a JSON object containing:
{
  "action": "create_appointment" | "create_invoice" | "create_contract" | "add_expense" | "add_client" | "view_schedule" | "view_accounting" | "unknown",
  "data": { ...extracted fields... },
  "spoken_response": "Natural response to speak back to user"
}

EXAMPLES:

User: "Schedule an appointment with John tomorrow at 2pm"
Response:
{
  "action": "create_appointment",
  "data": {
    "client_name": "John",
    "date": "2025-12-29",
    "time": "14:00",
    "title": "Service Visit"
  },
  "spoken_response": "I've scheduled an appointment with John for tomorrow at 2 PM."
}

User: "Create an invoice for $500 for plumbing work at Sarah's house"
Response:
{
  "action": "create_invoice",
  "data": {
    "client_name": "Sarah",
    "amount": 500,
    "description": "plumbing work",
    "status": "unpaid"
  },
  "spoken_response": "I've created a $500 invoice for plumbing work for Sarah."
}

User: "Add $50 gas expense"
Response:
{
  "action": "add_expense",
  "data": {
    "amount": 50,
    "category": "fuel",
    "description": "gas"
  },
  "spoken_response": "I've recorded a $50 gas expense."
}

User: "What's my schedule today?"
Response:
{
  "action": "view_schedule",
  "data": {
    "date": "2025-12-28"
  },
  "spoken_response": "Let me check your schedule for today."
}

User: "Add new client Mike Johnson, phone 555-1234"
Response:
{
  "action": "add_client",
  "data": {
    "name": "Mike Johnson",
    "phone": "555-1234"
  },
  "spoken_response": "I've added Mike Johnson to your client list."
}

IMPORTANT:
- Always extract all relevant information
- Use ISO date format (YYYY-MM-DD)
- Use 24-hour time format (HH:MM)
- Default appointment duration is 60 minutes
- Be conversational in spoken_response
- If the command is unclear, action should be "unknown"

Today's date is ${new Date().toISOString().split('T')[0]}.`;

// Main voice endpoint
app.post("/voice", async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  try {
    // Ask Claude to understand the command
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: text,
        },
      ],
    });

    // Parse Claude's response
    const responseText = message.content[0].text;
    let parsedResponse;
    
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse Claude response:", responseText);
      return res.json({
        spoken_response: "Sorry, I didn't understand that command.",
      });
    }

    const { action, data, spoken_response } = parsedResponse;

    res.json({
      action,
      data,
      spoken_response,
    });

  } catch (error) {
    console.error("Error processing voice command:", error);
    res.json({
      spoken_response: "Sorry, I encountered an error processing your request.",
    });
  }
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ status: "Voice backend is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voice backend running on port ${PORT}`);
});
