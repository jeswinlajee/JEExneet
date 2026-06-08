import { GoogleGenAI } from "@google/genai";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  try {
    const { topic, difficulty, questionCount = 10, sections = ["Maths", "Physics", "Chemistry"] } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: Netlify.env.get("GEMINI_API_KEY"),
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });

    const prompt = `Generate a realistic and high-quality exam based on the topic: "${topic}".
      Difficulty Level: ${difficulty} (e.g., Easy, Medium, Hard, JEE Advanced level).
      Total questions: ${questionCount}.
      Divide them into sections: ${sections.join(", ")}.

      ${questionCount == 75 ? "Set numericals to 5 per section (total 15), and the remaining 20 questions per section as MCQs." : "Each section should contain both 'mcqs' and 'numericals'."}
      MCQs must have 4 options labeled A, B, C, and D. There must be 1 correct answer. The 'correctAnswer' field MUST be the option label (e.g., "A").
      Numericals must have a single number as the answer.

      Return the result in JSON format matching this schema:
      {
        "title": "Exam Title",
        "duration": 180,
        "sections": {
          "Maths": { "name": "Maths", "mcqs": [...], "numericals": [...] },
          "Physics": { "name": "Physics", "mcqs": [...], "numericals": [...] },
          "Chemistry": { "name": "Chemistry", "mcqs": [...], "numericals": [...] }
        }
      }

      Question Schema:
      {
        "id": "unique_string",
        "type": "mcq" | "numerical",
        "text": "Question text",
        "options": ["A", "B", "C", "D"], // only for mcq
        "correctAnswer": "Answer"
      }`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const examData = JSON.parse(response.text);
    return Response.json(examData);
  } catch (error: any) {
    console.error("AI Generation Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/ai/generate-exam",
  method: "POST",
};
