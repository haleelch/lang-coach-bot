const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// പുതിയ Firebase Realtime Database URL ഇവിടെ നൽകിയിരിക്കുന്നു
const DB_URL = "[https://digital-locker-7c539-default-rtdb.asia-southeast1.firebasedatabase.app](https://digital-locker-7c539-default-rtdb.asia-southeast1.firebasedatabase.app)";
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).send("Digital Locker Bot is Active!");
  }

  try {
    const update = req.body;
    if (!update.message) return res.status(200).send("OK");

    const chatId = update.message.chat.id;
    const msg = update.message;

    // 1. ഫയലോ ഫോട്ടോയോ അയച്ചാൽ (Certificates അല്ലെങ്കിൽ Kitab Library-ലേക്ക് സേവ് ചെയ്യാൻ)
    if (msg.document || msg.photo) {
      let fileId = "";
      let fileType = "";

      if (msg.document) {
        fileId = msg.document.file_id;
        fileType = "document";
      } else if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        fileType = "photo";
      }

      const caption = (msg.caption || "").trim();

      if (!caption) {
        await sendMessage(
          chatId,
          "⚠️ **ദയവായി ഫയലിന്റെ കൂടെ ഒരു പേര് (Caption) കൂടി എഴുതി അയക്കൂ!**\n\n" +
          "• സർട്ടിഫിക്കറ്റ് ആണെങ്കിൽ: വെറുതെ പേര് എഴുതുക (ഉദാ: `SSLC`, `Plus Two`, `RC Book`)\n" +
          "• കിതാബ്/പുസ്തകം ആണെങ്കിൽ: തുടക്കത്തിൽ `kitab:` എന്ന് ചേർക്കുക (ഉദാ: `kitab: Fathul Mueen`)"
        );
        return res.status(200).send("OK");
      }

      let category = "certificates";
      let title = caption;

      if (caption.toLowerCase().startsWith("kitab:") || caption.toLowerCase().startsWith("book:")) {
        category = "library";
        title = caption.replace(/^(kitab:|book:)/i, "").trim();
      }

      await fetch(`${DB_URL}/${category}.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title,
          fileId: fileId,
          fileType: fileType,
          date: new Date().toLocaleDateString("en-IN")
        })
      });

      const catName = category === "library" ? "📚 Kitab Library" : "📄 Certificates";
      await sendMessage(chatId, `✅ **"${title}"** നിങ്ങളുടെ **${catName}**-ലേക്ക് വിജയകരമായി സേവ് ചെയ്തിട്ടുണ്ട്!\n\nഇനി എപ്പോൾ വേണമെങ്കിലും ചാറ്റിൽ ഇതിന്റെ പേര് ചോദിച്ചാൽ ഞാൻ സ്പോട്ടിൽ എടുത്തുതരാം.`);
      return res.status(200).send("OK");
    }

    // 2. ടെക്സ്റ്റ് മെസ്സേജുകൾ കൈകാര്യം ചെയ്യാൻ
    if (msg.text) {
      const userText = msg.text.trim();

      if (userText === "/start") {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "👋 **സ്വാഗതം ഹലീൽ! നിങ്ങളുടെ Digital Locker & Personal Staff തയ്യാറാണ്.**\n\n" +
                  "🔹 **ഫയൽ സേവ് ചെയ്യാൻ:** ഏത് സർട്ടിഫിക്കറ്റും ഫോട്ടോയും പേര് (Caption) എഴുതി ഇങ്ങോട്ട് അയക്കുക.\n" +
                  "🔹 **കിതാബ് സേവ് ചെയ്യാൻ:** PDF അയക്കുമ്പോൾ `kitab: പേര്` എന്ന് ക്യാപ്ഷൻ കൊടുക്കുക.\n" +
                  "🔹 **തിരിച്ചെടുക്കാൻ:** ഏത് ഫയലിന്റെയും നോട്ടിന്റെയും പേര് വെറുതെ ചോദിക്കുക!\n\n" +
                  "താഴെയുള്ള ബട്ടൺ അമർത്തി നിങ്ങളുടെ മുഴുവൻ പേജുകളും (Notes, Money, Library, Certificates) തുറക്കാം 👇",
            reply_markup: {
              inline_keyboard: [
                [{ text: "📱 Open My Digital Locker (All Pages)", url: "https://lang-coach-bot.vercel.app" }]
              ]
            }
          })
        });
        return res.status(200).send("OK");
      }

      const dbRes = await fetch(`${DB_URL}.json`);
      const dbData = (await dbRes.json()) || {};

      const certs = Object.values(dbData.certificates || {});
      const books = Object.values(dbData.library || {});
      const notes = Object.values(dbData.notes || {});
      const debts = Object.values(dbData.debts || {});
      const reminders = Object.values(dbData.reminders || {});

      const allFiles = [...certs, ...books];

      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const prompt = `
      You are Haleel's personal assistant & digital locker bot.
      Here is Haleel's saved data from Firebase:
      - Saved Files (Certificates & Kitabs): ${JSON.stringify(allFiles.map(f => f.title))}
      - Secret Notes & IDs: ${JSON.stringify(notes)}
      - Money / Debts: ${JSON.stringify(debts)}
      - Reminders: ${JSON.stringify(reminders)}

      User message: "${userText}"

      STRICT RULES:
      1. If the user is asking for a saved certificate, document, or kitab/book from the "Saved Files" list, reply ONLY with: SEND_FILE:<exact_title_from_list>
      2. If the user is asking about a saved note, ID, password, money/debt calculation, or reminder, answer clearly and accurately in Malayalam using the data above.
      3. Otherwise, reply helpfully in Malayalam as Haleel's smart personal staff.
      `;

      const result = await model.generateContent(prompt);
      const aiReply = result.response.text().trim();

      if (aiReply.startsWith("SEND_FILE:")) {
        const targetTitle = aiReply.replace("SEND_FILE:", "").trim().toLowerCase();
        const foundFile = allFiles.find(f => f.title.toLowerCase() === targetTitle || f.title.toLowerCase().includes(targetTitle));

        if (foundFile) {
          await sendFile(chatId, foundFile.fileId, foundFile.fileType, `📄 ഇതാ നിങ്ങളുടെ **${foundFile.title}**`);
        } else {
          await sendMessage(chatId, `⚠️ ആ ഫയൽ കണ്ടെത്താനായില്ല. ദയവായി ഫയൽ ഒരിക്കൽ കൂടി ക്യാപ്ഷൻ ഇട്ട് അയക്കൂ.`);
        }
      } else {
        await sendMessage(chatId, aiReply);
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error(error);
    res.status(200).send("Error handled");
  }
};

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function sendFile(chatId, fileId, type, caption) {
  const endpoint = type === "photo" ? "sendPhoto" : "sendDocument";
  const body = { chat_id: chatId, caption, parse_mode: "Markdown" };
  body[type] = fileId;

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
    }
                      
