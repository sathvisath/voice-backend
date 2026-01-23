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
   If NEW: "Please create the client first, then create the appointment."
   If EXISTING: Collect title, date, time, address, duration_minutes, notes

2. CLIENT:
   Collect: name, phone, address, email, language_preference, notes

3. INCOME (requires client + job):
   Ask: "Is this for existing or new client?"
   If NEW: "Please create client first"
   If EXISTING: Lookup client → lookup jobs → collect amount, date, category, payment_method, notes

4. EXPENSE (optional client + job):
   Ask: "Is this related to a client/job or general business expense?"
   Collect: amount, date, category, vendor, description, payment_method, is_tax_deductible

5. CONTRACT (requires client + job):
   Ask: "Existing or new client?"
   If NEW: "Please create client first"
   If EXISTING: Lookup client → lookup jobs → collect title, services, hourly_rate, total_charges, contract_date
   Validate: hourly_rate and total_charges must NOT be 0

6. INVOICE (requires client + job):
   Same flow as contract
   Collect line items, calculate totals, collect dates

RESPONSE FORMAT FOR VAPI:
Return ONLY plain text that should be spoken. No JSON, no special formatting.
Example: "Perfect! English it is. What would you like to do today?"

Today's date is ${new Date().toISOString().split('T')[0]}.`;

const conversationHistory = new Map();

// VAPI WEBHOOK ENDPOINT
app.post("/vapi", async (req, res) => {
  try {
    console.log("📞 VAPI Request Body:", JSON.stringify(req.body, null, 2));
    
    // Extract user message from various possible formats
    const userMessage = req.body.message?.content || 
                        req.body.message?.transcript || 
                        req.body.message?.text ||
                        req.body.transcript ||
                        req.body.text || "";
    
    const callId = req.body.call?.id || 
                   req.body.callId || 
                   "default";
    
    console.log("👤 User:", userMessage);
    console.log("📞 Call ID:", callId);
    
    if (!userMessage.trim()) {
      console.log("⚠️ Empty message received");
      return res.json({
        content: "I didn't catch that. Could you please repeat?"
      });
    }
    
    // Get or create conversation history
    if (!conversationHistory.has(callId)) {
      conversationHistory.set(callId, []);
      console.log("✨ New conversation started");
    }
    
    const history = conversationHistory.get(callId);
    
    // Add user message
    history.push({
      role: "user",
      content: userMessage.trim()
    });
    
    // Keep last 50 messages
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
    
    console.log("💬 History length:", history.length);
    
    // Call Claude
    const anthropicMessage = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: history
    });
    
    const responseText = anthropicMessage.content[0].text.trim();
    
    console.log("🤖 Assistant:", responseText);
    
    // Add to history
    history.push({
      role: "assistant",
      content: responseText
    });
    
    conversationHistory.set(callId, history);
    
    // Return plain text for VAPI
    res.json({
      content: responseText
    });
    
  } catch (error) {
    console.error("❌ Error:", error);
    console.error("Error details:", error.message);
    res.json({
      content: "I'm sorry, I had a technical issue. Could you try that again?"
    });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({ 
    status: "Voice backend running",
    endpoints: {
      vapi: "/vapi",
      health: "/"
    }
  });
});

// Clear conversation
app.post("/vapi/clear", (req, res) => {
  const callId = req.body.callId || "default";
  conversationHistory.delete(callId);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎤 Voice backend running on port ${PORT}`);
  console.log(`📞 VAPI webhook: https://your-domain.com/vapi`);
  console.log(`✅ Health check: https://your-domain.com/`);
});
