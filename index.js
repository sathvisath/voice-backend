import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a bilingual conversational voice assistant for a solo business management app used by plumbers, electricians, cleaners, contractors, and service professionals.

LANGUAGE SUPPORT:
- You speak both ENGLISH and SPANISH fluently
- At the START of EVERY new conversation, ask: "English or Spanish?" / "¿Inglés o Español?"
- Once language is selected, ALL responses must be in that language
- Remember the language choice throughout the conversation

CORE BEHAVIOR:
- Have natural CONVERSATIONS with users
- Ask for information ONE FIELD AT A TIME
- MUST ask for ALL required fields - never skip any field
- Maintain context throughout the conversation
- Confirm all details before saving

CRITICAL RULE - DATA CONNECTIVITY:
ALL business records must be connected: CLIENT → JOB → (Income/Expense/Invoice/Contract)

ENTITIES:

1. APPOINTMENT (JOB):
   Ask: "Is this for a new client or existing client?"
   If NEW: "Please create the client first using 'add client', then create the appointment."
   If EXISTING: Ask for client name, set needs_client_lookup true

2. CLIENT:
   Collect: name, phone, address, email, language_preference, notes

3. INCOME (requires client + job):
   Ask: "Is this for existing or new client?"
   If NEW: "Please create client first"
   If EXISTING: Client lookup → job lookup → collect fields

4. EXPENSE (optional client + job):
   Ask: "Is this related to a client/job or general business expense?"

5. CONTRACT (requires client + job):
   Ask: "Existing or new client?"
   If EXISTING: Client lookup → job lookup
   Validate: hourly_rate and total_charges must NOT be 0

6. INVOICE (requires client + job):
   Same flow, collect line items, calculate totals

RESPONSE FORMAT:
Return ONLY plain text that should be spoken. Keep responses natural and conversational.
Example: "Perfect! English it is. What would you like to do today?"

Today's date is ${new Date().toISOString().split('T')[0]}.`;

const conversationHistory = new Map();

// ElevenLabs endpoint (PRIMARY)
app.post("/elevenlabs", async (req, res) => {
  try {
    console.log("📞 ElevenLabs request received");
    console.log("📦 Request body:", JSON.stringify(req.body, null, 2));
    
    // Extract text from various possible formats
    const userText = req.body.text || 
                     req.body.message || 
                     req.body.transcript ||
                     req.body.input ||
                     req.body.prompt ||
                     "";
    
    const sessionId = req.body.conversation_id || 
                      req.body.session_id ||
                      req.body.conversationId ||
                      "default";
    
    console.log("👤 User said:", userText);
    console.log("🆔 Session ID:", sessionId);
    
    if (!userText || !userText.trim()) {
      console.log("⚠️ Empty message received");
      return res.json({
        response: "I didn't catch that. Could you please repeat?",
        text: "I didn't catch that. Could you please repeat?"
      });
    }
    
    // Get or create conversation history
    if (!conversationHistory.has(sessionId)) {
      conversationHistory.set(sessionId, []);
      console.log("✨ New conversation started for session:", sessionId);
    }
    
    const history = conversationHistory.get(sessionId);
    
    // Add user message
    history.push({
      role: "user",
      content: userText.trim()
    });
    
    // Keep last 50 messages
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
    
    console.log("💬 History length:", history.length);
    
    // Call Claude API
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: history
    });
    
    const responseText = message.content[0].text.trim();
    
    console.log("🤖 Claude response:", responseText);
    
    // Add assistant response to history
    history.push({
      role: "assistant",
      content: responseText
    });
    
    conversationHistory.set(sessionId, history);
    
    // Return response in multiple formats for compatibility
    res.json({
      response: responseText,
      text: responseText,
      message: responseText
    });
    
  } catch (error) {
    console.error("❌ Error in /elevenlabs:", error);
    console.error("Error stack:", error.stack);
    res.json({
      response: "Sorry, I encountered a technical issue. Could you please try that again?",
      text: "Sorry, I encountered a technical issue. Could you please try that again?",
      error: error.message
    });
  }
});

// Original voice endpoint (for compatibility)
app.post("/voice", async (req, res) => {
  const { text, sessionId } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  const session = sessionId || "default";
  
  if (!conversationHistory.has(session)) {
    conversationHistory.set(session, []);
  }
  
  const history = conversationHistory.get(session);
  
  history.push({
    role: "user",
    content: text
  });

  if (history.length > 50) {
    history.splice(0, history.length - 50);
  }

  try {
    console.log("📝 User said:", text);
    console.log("💬 History length:", history.length);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: history
    });

    const responseText = message.content[0].text;
    console.log("🤖 Raw response:", responseText);

    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.substring(7);
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.substring(3);
    }
    if (cleanedText.endsWith('```')) {
      cleanedText = cleanedText.substring(0, cleanedText.length - 3);
    }
    cleanedText = cleanedText.trim();

    const parsedResponse = JSON.parse(cleanedText);
    
    history.push({
      role: "assistant",
      content: responseText
    });
    
    conversationHistory.set(session, history);

    console.log("✅ Parsed response:", parsedResponse);

    res.json({
      ...parsedResponse,
      sessionId: session
    });

  } catch (error) {
    console.error("❌ Error:", error);
    res.json({
      state: "error",
      action: null,
      data: {},
      missing_fields: [],
      next_question: null,
      spoken_response: "Sorry, I encountered an error. Could you repeat that?",
      ready_to_save: false,
      sessionId: session
    });
  }
});

// Clear conversation
app.post("/voice/clear", (req, res) => {
  const { sessionId } = req.body;
  const session = sessionId || "default";
  conversationHistory.delete(session);
  console.log("🗑️ Cleared conversation for session:", session);
  res.json({ success: true, message: "Conversation cleared" });
});

// Health check
app.get("/", (req, res) => {
  res.json({ 
    status: "Voice backend running",
    endpoints: {
      elevenlabs: "/elevenlabs (ElevenLabs Conversational AI)",
      voice: "/voice (Original endpoint)",
      clear: "/voice/clear"
    },
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for ElevenLabs
app.get("/elevenlabs", (req, res) => {
  res.json({
    message: "ElevenLabs endpoint is active",
    method: "POST",
    expectedFormat: {
      text: "user message",
      conversation_id: "session_id"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎤 Voice backend running on port ${PORT}`);
  console.log(`📞 ElevenLabs endpoint: /elevenlabs`);
  console.log(`🔊 Original endpoint: /voice`);
  console.log(`✅ Health check: /`);
});
