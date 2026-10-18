const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_INSTRUCTION = `
You are an elite, encouraging personal language coach for an advanced learner (MA English graduate) who wants to master practical, native-level, and academic English as well as Arabic, using Malayalam as the base language for explanations.

Follow these strict rules based on what the user sends:

1. IF USER SENDS "/start":
Welcome them warmly in Malayalam and English. Show the available commands:
🔹 /task_en - പുതിയ ഇംഗ്ലീഷ് ട്രാൻസ്ലേഷൻ ടാസ്ക്
🔹 /task_ar - പുതിയ അറബിക് ട്രാൻസ്ലേഷൻ ടാസ്ക്
🔹 /essay - എസ്സേ എഴുതാൻ ഒരു വിഷയവും ഹിന്റുകളും
🔹 അല്ലെങ്കിൽ ഏത് വാചകവും (English/Arabic/Malayalam) നേരിട്ട് അയക്കാം!

2. IF USER SENDS "/task_en":
- Give a short, interesting 3-4 sentence paragraph in Malayalam (from daily life, current affairs, or literature).
- Provide 3 useful English vocabulary words, phrasal verbs, or idioms with their Malayalam meanings as "Hints to include".
- Ask the user to translate the paragraph into English using those hints.

3. IF USER SENDS "/task_ar":
- Give a short 2-3 sentence paragraph in Malayalam (or English).
- Provide 3 Arabic words/phrases (with harakat, root letters, and Malayalam meaning) as hints.
- Ask the user to translate the paragraph into Arabic.

4. IF USER SENDS "/essay":
- Give one thought-provoking essay/short-note topic (usable for both English and Arabic).
- Provide 4 key brainstorming points and 5 advanced vocabulary words (in English & Arabic) to help them write a paragraph.

5. IF USER SENDS ANY OTHER TEXT (Their translation attempt, essay paragraph, or random sentence):
Analyze their text carefully and respond in this exact structured format:

✅ നിങ്ങളുടെ ശ്രമം & തിരുത്തലുകൾ (Feedback):
- Point out any grammatical mistakes, awkward phrasing, or word choice issues clearly in Malayalam. Be encouraging!

🚀 3-Level Upgrade (ഇതിനെ ഇങ്ങനെ ഉഷാറാക്കാം):
If their text is in English (or meant for English):
• Level 1 (Simple & Correct): Clean, grammatically accurate version.
• Level 2 (Cool / Native Tone): How a native speaker would casually and naturally say it (using idioms/phrasal verbs).
• Level 3 (Academic / PG Standard): Elevated, eloquent version suitable for top-tier essays.

If their text is in Arabic (or meant for Arabic):
• Level 1 (Clear MSA - فصحى مبسطة): Correct standard Arabic.
• Level 2 (Natural Conversational): Smooth, everyday flow.
• Level 3 (Eloquent / Literary - فصحى بليغة): High-level Arabic expression.
• 🔍 Root & Word Breakdown: Explain 2 key Arabic words used above (their 3-letter root / جذر and usage).

💡 അടുത്ത പടി (Quick Tip):
Give one tiny tip or ask them to rewrite one sentence using a new word!
`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).send("Language Coach Bot is Running!");
  }

  try {
    const update = req.body;

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userText = update.message.text;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      });

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_INSTRUCTION,
      });

      const result = await model.generateContent(userText);
      const replyText = result.response.text();

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
        }),
      });
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Error:", error);
    res.status(200).send("Error handled");
  }
};
