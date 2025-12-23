import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/voice", async (req, res) => {
  const { text } = req.body;

  // TEMP: assume intent already parsed
  // Replace later with LLM parsing
  const appointment = {
    title: "Service Visit",
    client_name: "John",
    date: "2025-12-24",
    time: "10:00"
  };

  try {
    const response = await fetch(
      "https://api.base44.com/entities/Appointment",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.BASE44_API_KEY}`
        },
        body: JSON.stringify({
          title: appointment.title,
          date: appointment.date,
          time: appointment.time,
          client_name: appointment.client_name
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Base44 error:", errText);
      throw new Error("Base44 rejected request");
    }

    res.json({
      spoken_response: "Okay, I’ve scheduled your appointment."
    });

  } catch (error) {
    console.error(error);
    res.json({
      spoken_response: "Sorry, I could not save the appointment."
    });
  }
});

app.listen(3000, () => {
  console.log("Voice backend running on port 3000");
});

