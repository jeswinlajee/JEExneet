import { GoogleGenAI } from "@google/genai";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  try {
    const { fileData, mimeType } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: Netlify.env.get("GEMINI_API_KEY"),
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });

    const prompt = `Analyze this question paper document.
      1. Extract all questions including MCQs and Numericals.
      2. Categorize them into Maths, Physics, and Chemistry if applicable.
      3. Identify any errors in the questions (missing options, ambiguous text).
      4. Return the structured exam data and an 'errors' list.

      Return format:
      {
        "exam": {
          "title": "Extracted Title",
          "duration": 180,
          "sections": { ... same structure as generate-exam ... }
        },
        "analysis": {
          "errors": ["Error 1", "Error 2"],
          "summary": "Summary of the paper"
        }
      }`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        { inlineData: { mimeType, data: fileData } },
        { text: prompt },
      ],
      config: { responseMimeType: "application/json" },
    });

    const analysisResult = JSON.parse(response.text);
    return Response.json(analysisResult);
  } catch (error: any) {
    console.error("Document Analysis Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/ai/analyze-document",
  method: "POST",
};
