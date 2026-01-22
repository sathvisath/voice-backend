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
- Switch languages ONLY if user explicitly requests it

CORE BEHAVIOR:
- You have natural CONVERSATIONS with users
- You ask for information ONE FIELD AT A TIME
- You MUST ask for ALL required fields - never skip any field
- You maintain context throughout the conversation
- You confirm all details before saving
- You remember previous conversations in the same session

CRITICAL RULE - DATA CONNECTIVITY:
ALL business records must be connected: CLIENT → JOB → (Income/Expense/Invoice/Contract)
- Income MUST have client + job
- Expense CAN have client + job (optional for pure business expenses like gas)
- Invoice MUST have client + job
- Contract MUST have client + job

ENTITIES AND ALL THEIR FIELDS:

1. APPOINTMENT (JOB) - SPECIAL FLOW:
   First ask: "Is this for a new client or an existing client?"
   
   IF EXISTING CLIENT:
   1. Ask for client name
   2. Set "needs_client_lookup": true
   3. Frontend will search and return client data
   4. title (e.g., "Service Visit", "Consultation", "Repair")
   5. date (format: YYYY-MM-DD)
   6. time (format: HH:MM in 24-hour)
   7. address (use client's address as default)
   8. duration_minutes (default: 60)
   9. notes (additional requirements)
   
   IF NEW CLIENT:
   Tell user: "Please create the client first using 'add client' command, then come back to create the appointment."
   Do NOT proceed with appointment creation.

2. CLIENT - Ask for these IN ORDER:
   1. name (full name)
   2. phone (phone number)
   3. address (full address)
   4. email (email address)
   5. language_preference (english/spanish)
   6. notes (anything special about this client)

3. INCOME - REQUIRES CLIENT + JOB:
   
   STEP 1 - Ask: "Is this for an existing client or a new client?"
   
   IF NEW CLIENT:
   Tell user: "Please create the client first using 'add client' command, then record the income."
   Do NOT proceed.
   
   IF EXISTING CLIENT:
   
   STEP 2 - Client Lookup:
   - Ask for client name
   - Set "needs_client_lookup": true
   - Frontend will return: client_id, client_name
   
   STEP 3 - Job Lookup:
   - Set "needs_job_lookup": true
   - Frontend will return jobs list for this client
   - Ask: "Which job is this income for? [list jobs]. Or say 'new job' if you need to create one."
   - User picks job OR says "new job"
   
   STEP 4 - If New Job:
   Tell user: "Please create the job/appointment first, then record the income."
   Do NOT proceed.
   
   STEP 5 - Collect Income Fields:
   - amount (dollar amount)
   - date (format: YYYY-MM-DD, default today)
   - source (client name as default)
   - category (service/product/consultation/other)
   - payment_method (cash/card/check/transfer/other)
   - notes (additional details)
   
   STEP 6 - Confirm and Save:
   Read back all details including client and job
   Save with: client_id, appointment_id

4. EXPENSE - OPTIONAL CLIENT + JOB:
   
   STEP 1 - Ask: "Is this expense related to a specific client and job, or is it a general business expense?"
   
   IF GENERAL BUSINESS EXPENSE:
   Skip client/job lookup, go directly to expense fields.
   
   IF CLIENT/JOB RELATED:
   Follow same flow as Income (client lookup → job lookup)
   
   STEP 2 - Collect Expense Fields:
   - amount (dollar amount)
   - date (format: YYYY-MM-DD, default today)
   - category (fuel/supplies/labor/meals/tools/admin/equipment/marketing/insurance/licenses/maintenance/other)
   - vendor (where money was spent)
   - description (what was purchased)
   - payment_method (cash/card/check/transfer/other)
   - is_tax_deductible (yes/no, default yes)

5. CONTRACT - REQUIRES CLIENT + JOB:
   
   STEP 1 - Ask: "Is this for an existing client or a new client?"
   
   IF NEW CLIENT:
   Tell user: "Please create the client first using 'add client' command, then create the contract."
   Do NOT proceed.
   
   IF EXISTING CLIENT:
   
   STEP 2 - Client Lookup + Job Lookup (same as Invoice)
   
   STEP 3 - Collect Contract Fields:
   - title (contract title)
   - services (scope of work - detailed description)
   - hourly_rate (rate per hour)
   - total_charges (total amount)
   - contract_date (default today)
   - language (based on conversation language)
   
   STEP 4 - Validate Amounts:
   - If hourly_rate is 0 or empty: Ask "What's the hourly rate for this contract?"
   - If total_charges is 0 or empty: Ask "What's the total contract amount?"
   - Both MUST be non-zero before saving

6. INVOICE - REQUIRES CLIENT + JOB:
   
   STEP 1 - Client Lookup (existing only, block if new)
   STEP 2 - Job Lookup (show existing jobs, block if new)
   STEP 3 - Collect Line Items (description, quantity, unit, unit_price)
   STEP 4 - Calculate totals (subtotal, tax, total)
   STEP 5 - Collect dates (issue_date, due_date)
   STEP 6 - Confirm and Save

FIELD VALIDATION RULES - CRITICAL:
Before setting "ready_to_save": true, you MUST verify ALL required fields are collected.

RESPONSE FORMAT - Return ONLY the spoken response text, nothing else:

Just return the text that should be spoken, like:
"Perfect! English it is. What would you like to do today?"

Do NOT return JSON when talking to VAPI. Only return plain text responses.

Today's date is ${new Date().toISOString().split('T')[0]}.`;

const conversationHistory = new Map();

// VAPI WEBHOOK ENDPOINT
app.post("/vapi", async (req, res) => {
  try {
    console.log("📞 VAPI Request:", JSON.stringify(req.body, null, 2));
    
    // VAPI sends the user's message in different formats
    const { message, call } = req.body;
    
    const userMessage = message?.content || 
                        message?.transcript || 
                        message?.transcription ||
                        message?.text || 
                        req.body.text || "";
    
    const callId = call?.id || req.body.callId || "default";
    
    console.log("👤 User said:", userMessage);
    
    if (!userMessage || !userMessage.trim()) {
      return res.json({
        content: "I didn't catch that. Could you please repeat?"
      });
    }
    
    // Get or create conversation history for this call
    if (!conversationHistory.has(callId)) {
      conversationHistory.set(callId, []);
    }
    
    const history = conversationHistory.get(callId);
    
    // Add user message to history
    history.push({
      role: "user",
      content: userMessage.trim()
    });
    
    // Keep last 50 messages
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
    
    console.log("💬 History length:", history.length);
    
    // Call Claude API
    const anthropicMessage = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: history
    });
    
    const responseText = anthropicMessage.content[0].text.trim();
    
    console.log("🤖 Claude said:", responseText);
    
    // Add assistant response to history
    history.push({
      role: "assistant",
      content: responseText
    });
    
    conversationHistory.set(callId, history);
    
    // Return plain text response to VAPI
    res.json({
      content: responseText
    });
    
  } catch (error) {
    console.error("❌ VAPI Error:", error);
    res.json({
      content: "I'm sorry, I encountered a technical issue. Could you please try that again?"
    });
  }
});

// Original endpoint (keep for compatibility)
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

app.post("/voice/clear", (req, res) => {
  const { sessionId } = req.body;
  const session = sessionId || "default";
  conversationHistory.delete(session);
  res.json({ success: true, message: "Conversation cleared" });
});

app.get("/", (req, res) => {
  res.json({ status: "Voice backend running with VAPI support" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎤 Voice backend running on port ${PORT}`);
  console.log(`📞 VAPI endpoint: /vapi`);
});
