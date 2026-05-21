import { GoogleGenAI } from "@google/genai";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  try {
    const { text, images } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: Netlify.env.get("GEMINI_API_KEY"),
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });

    const parts: any[] = [];

    if (images && images.length > 0) {
      images.forEach((img: any) => {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.fileData } });
      });
    }

    const textPrompt = `You are an elite academic mentor and 'Google Lens' standard question solver on the Conqueror Preparation Platform.
Analyze the provided query and/or images of the question.
Your objective is to:
1. Conduct search queries if needed to locate other variations or exact formulations of this question online.
2. Provide a rigorous, step-by-step, clear academic explanation showing how to solve this exact problem.
3. Show all mathematical formulas, diagram explanations, and chemical structures/reactions if applicable.
4. Conclude with a prominently highlighted final correct answer block or selected option (A, B, C, or D).

User's accompanying text/question data: ${text || "Please analyze and solve the attached question in detail."}`;

    parts.push({ text: textPrompt });

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: parts,
      config: {
        systemInstruction:
          "You are a world-class academic tutor powered by Conqueror Preparation Platform. Do not make up facts. Search the web to verify formulas, values, or current affairs if they are referenced. Use beautiful markdown for output design.",
        tools: [{ googleSearch: {} }],
      },
    });

    const solution = response.text;
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const sources = chunks
      ? chunks.filter((c: any) => c.web).map((c: any) => ({ title: c.web.title, url: c.web.uri }))
      : [];

    return Response.json({ solution, sources });
  } catch (error: any) {
    console.error("Doubt Solver Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/ai/solve-doubt",
  method: "POST",
};
