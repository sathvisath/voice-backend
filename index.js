import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/voice", (req, res) => {
  const { text } = req.body;

  console.log("VOICE RECEIVED:", text);

  if (!text) {
    return res.json({
      spoken_response: "I didn’t hear anything. Please try again."
    });
  }

  const command = text.toLowerCase();

  /* ===============================
     INTENT: CREATE APPOINTMENT
     =============================== */

  if (
    command.includes("schedule") ||
    command.includes("book") ||
    command.includes("appointment")
  ) {
    // 👉 Extract client name
    let clientName = "client";
    const withMatch = command.match(/with ([a-z ]+)/);
    if (withMatch) {
      clientName = withMatch[1].trim();
    }

    // 👉 Extract date
    let dateObj = new Date();
    if (command.includes("tomorrow")) {
      dateObj.setDate(dateObj.getDate() + 1);
    }
    const date = dateObj.toISOString().split("T")[0];

    // 👉 Extract time (basic AM/PM handling)
    let time = "10:00";
    const timeMatch = command.match(/(\d{1,2})(?:\s)?(am|pm)/);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const period = timeMatch[2];
      if (period === "pm" && hour < 12) hour += 12;
      if (period === "am" && hour === 12) hour = 0;
      time = `${hour.toString().padStart(2, "0")}:00`;
    }

    return res.json({
      intent: "create_appointment",
      data: {
        title: "Service Appointment",
        client_name: clientName,
        date,
        time,
        status: "scheduled"
      },
      spoken_response: `Okay, I’ve scheduled your appointment with ${clientName} on ${dateObj.toDateString()} at ${time}.`
    });
  }

  /* ===============================
     FALLBACK
     =============================== */

  return res.json({
    spoken_response: "Sorry, I didn’t understand that command."
  });
});

app.listen(3000, () => {
  console.log("Voice backend running on port 3000");
});
