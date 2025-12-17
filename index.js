import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/voice", (req, res) => {
  const { text } = req.body;

  console.log("VOICE RECEIVED:", text);

  res.json({
    spoken_response: `I heard you say ${text}`
  });
});

app.listen(3000, () => {
  console.log("Voice backend running on port 3000");
});
