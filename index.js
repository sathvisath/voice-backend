import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// REPLACE THESE WITH YOUR ACTUAL KEYS
const DEEPGRAM_API_KEY = "098dc06c69e50494bf2af2031f1e3e681591b65f";
const ELEVENLABS_API_KEY = "sk_aa1236df45c22763640971579a026ef712b0c2c18e97888d";
const ELEVENLABS_AGENT_ID = "agent_5501kfrhjk0qe60tg5x15qz8xy89";

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
   If EXISTING: Ask for client name, set "needs_client_lookup": true

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

RESPONSE FORMAT - Always return valid JSON:
{
  "state": "selecting_language" | "collecting_data" | "confirming" | "complete" | "reading_data" | "error" | "blocked",
  "language": "english" | "spanish" | null,
  "action": "create_appointment" | "create_invoice" | "create_contract" | "add_expense" | "add_income" | "add_client" | "view_schedule" | null,
  "data": { all collected data },
  "client_type": "new" | "existing" | null,
  "needs_client_lookup": true | false,
  "needs_job_lookup": true | false,
  "lookup_client_name": "name" | null,
  "missing_fields": ["field1"],
  "blocked_reason": "reason" | null,
  "next_question": "Question to ask",
  "spoken_response": "Natural response IN THE SELECTED LANGUAGE",
  "ready_to_save": true | false
}

Today's date is ${new Date().toISOString().split('T')[0]}.`;

const conversationHistory = new Map();

// Main voice endpoint
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

// Text-to-Speech endpoint (ElevenLabs)
app.post("/tts", async (req, res) => {
  const { text, voiceId } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  try {
    const voice = voiceId || "EXAVITQu4vr4xnSDxMaL"; // Sarah voice by default

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength
    });
    
    res.send(Buffer.from(audioBuffer));

  } catch (error) {
    console.error("TTS Error:", error);
    res.status(500).json({ error: "Text-to-speech failed" });
  }
});

app.post("/voice/clear", (req, res) => {
  const { sessionId } = req.body;
  const session = sessionId || "default";
  conversationHistory.delete(session);
  res.json({ success: true, message: "Conversation cleared" });
});

app.get("/", (req, res) => {
  res.json({ 
    status: "Voice backend running",
    endpoints: {
      voice: "/voice",
      tts: "/tts",
      clear: "/voice/clear"
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎤 Voice backend running on port ${PORT}`);
  console.log(`🔊 TTS endpoint: /tts`);
});
```

**⚠️ REPLACE THESE 3 VALUES:**
- Line 13: `YOUR_DEEPGRAM_API_KEY_HERE`
- Line 14: `YOUR_ELEVENLABS_API_KEY_HERE`
- Line 15: `YOUR_ELEVENLABS_AGENT_ID_HERE`

---

## **PART 2: FRONTEND PROMPT FOR BASE44**

Give this prompt to base44:
```
Update VoiceAssistantWidget to use Deepgram + ElevenLabs for iOS-compatible voice.

INSTALL PACKAGES FIRST:
npm install @deepgram/sdk

COMPONENT STRUCTURE:

1. Import:
   - import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'
   - Keep existing lucide-react icons
   - Keep base44Client

2. Configuration (add at top of component):
   const DEEPGRAM_API_KEY = "YOUR_DEEPGRAM_API_KEY_HERE";
   const BACKEND_URL = "https://voice-backend-fwj6.onrender.com";

3. State:
   - isOpen: boolean
   - isListening: boolean  
   - isProcessing: boolean
   - isSpeaking: boolean
   - conversationHistory: array
   - sessionId: string
   - selectedLanguage: string | null
   - mediaRecorder: MediaRecorder | null
   - deepgramSocket: WebSocket | null

4. Audio Capture with MediaRecorder (works on iOS Safari):

   startListening function:
   - Request microphone: navigator.mediaDevices.getUserMedia({ audio: true })
   - Create MediaRecorder with audio stream
   - Connect to Deepgram WebSocket: wss://api.deepgram.com/v1/listen
   - Send audio chunks to Deepgram in real-time
   - On transcript received: send to backend, get response
   - Get audio from /tts endpoint
   - Play audio response
   - Stop listening after response completes

5. Deepgram WebSocket Setup:
   - URL: wss://api.deepgram.com/v1/listen?model=nova-2&language=en
   - Headers: Authorization: Token DEEPGRAM_API_KEY
   - Send audio as binary chunks
   - Listen for transcript events
   - Handle final transcripts only (ignore interim)

6. TTS Playback:
   - Fetch from: BACKEND_URL/tts
   - Body: { text: responseText }
   - Response is audio/mpeg
   - Create Audio element and play
   - Set isSpeaking true while playing
   - Set isSpeaking false when done

7. UI (keep existing design):
   - Floating mic button (blue gradient, bottom-right)
   - Modal with conversation history
   - User messages: blue bubbles, right-aligned
   - Assistant messages: white bubbles, left-aligned
   - Status indicators: listening (green), processing (yellow), speaking (purple)
   - Start/stop button for voice
   - Clear conversation button

8. Error Handling:
   - Check microphone permissions
   - Handle Deepgram connection errors
   - Handle TTS errors
   - Show error toasts

9. Cleanup on unmount:
   - Close Deepgram WebSocket
   - Stop MediaRecorder
   - Stop all audio

Build this component with proper WebRTC audio capture that works on iOS Safari.

