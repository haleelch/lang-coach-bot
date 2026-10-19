const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DB_URL = "https://digital-locker-7c539-default-rtdb.asia-southeast1.firebasedatabase.app";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).send("Telegram Digital Locker Bot is Active!");
  }

  try {
    const update = req.body;
    
    // Inline Button Click cheyyumbol varുന്ന callback_query handle cheyyan
    if (update.callback_query) {
      const q = update.callback_query;
      const chatId = q.message.chat.id;
      const data = q.data;

      if (data === "menu_certs") {
        await sendMessage(chatId, "📄 **Certificates Section**\n\nനിങ്ങളുടെ SSLC, Plus Two, Degree തുടങ്ങിയ സർട്ടിഫിക്കറ്റുകളുടെ ഫോട്ടോയോ PDF-ഓ ഇങ്ങോട്ട് അയക്കുക. അയക്കുമ്പോൾ ഒപ്പം ഫയലിന്റെ പേര് (ഉദാ: `SSLC`) Caption ആയി കൊടുക്കുക!");
      } else if (data === "menu_library") {
        await sendMessage(chatId, "📚 **Kitab Library Section**\n\nനിങ്ങളുടെ കിതാബുകളുടെ PDF ഇങ്ങോട്ട് അയക്കുക. അയക്കുമ്പോൾ `kitab: കിതാബിന്റെ പേര്` എന്ന് Caption കൊടുക്കുക!");
      } else if (data === "menu_notes") {
        await sendMessage(chatId, "📝 **Secret Notes & IDs**\n\nപ്രധാനപ്പെട്ട നമ്പറുകൾ അല്ലെങ്കിൽ പാസ്‌വേഡുകൾ സേവ് ചെയ്യാൻ:\n`note: IGNOU ID - 123456` എന്ന് ടൈപ്പ് ചെയ്ത് അയക്കുക.");
      } else if (data === "menu_money") {
        await sendMessage(chatId, "💰 **Money & Debts**\n\nപണമിടപാടുകൾ നോട്ട് ചെയ്യാൻ:\n`debt: Mansoor give 500` അല്ലെങ്കിൽ `debt: Rahul get 1000` എന്ന് ടൈപ്പ് ചെയ്ത് അയക്കുക.");
      }

      return res.status(200).send("OK");
    }

    if (!update.message) return res.status(200).send("OK");

    const chatId = update.message.chat.id;
    const msg = update.message;

    // 1. Files / Certificates / Kitabs send cheyyumbol database-il save cheyyan
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
          "• സർട്ടിഫിക്കറ്റ് ആണെങ്കിൽ: വെറുതെ പേര് എഴുതുക (ഉദാ: `sslc`, `plus two`)\n" +
          "• കിതാബ് ആണെങ്കിൽ: തുടക്കത്തിൽ `kitab:` എന്ന് ചേർക്കുക (ഉദാ: `kitab: Fathul Mueen`)"
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
      await sendMessage(chatId, `✅ **"${title}"** നിങ്ങളുടെ **${catName}**-ലേക്ക് വിജയകരമായി സേവ് ചെയ്തിട്ടുണ്ട്! ചാറ്റിൽ എപ്പോൾ വേണമെങ്കിലും ഇത് ചോദിച്ചാൽ ഞാൻ എടുത്തുതരാം.`);
      return res.status(200).send("OK");
    }

    // 2. Chat-il text message ayakkumbol
    if (msg.text) {
      const userText = msg.text.trim();

      if (userText === "/start" || userText.toLowerCase() === "menu") {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "👋 **സ്വാഗതം ഹലീൽ! നിങ്ങളുടെ ഡിജിറ്റൽ ലോക്കർ മെനുവിലേക്ക് സ്വാഗതം.**\n\nതാഴെയുള്ള ബട്ടണുകൾ ഉപയോഗിച്ച് നിങ്ങൾക്ക് ഏത് വിഭാഗത്തിലേക്കും മാറാവുന്നതാണ് 👇",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📄 Certificates", callback_data: "menu_certs" },
                  { text: "📚 Kitab Library", callback_data: "menu_library" }
                ],
                [
                  { text: "📝 Secret Notes", callback_data: "menu_notes" },
                  { text: "💰 Money Tracker", callback_data: "menu_money" }
                ]
              ]
            }
          })
        });
        return res.status(200).send("OK");
      }

      // Note save cheyyunnathe check cheyyan (e.g., note: title - content)
      if (userText.toLowerCase().startsWith("note:")) {
        const contentPart = userText.replace(/^note:/i, "").trim();
        const [nTitle, ...nRest] = contentPart.split("-");
        const nContent = nRest.join("-").trim();

        if (nTitle && nContent) {
          await fetch(`${DB_URL}/notes.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: nTitle.trim(), content: nContent, date: new Date().toLocaleDateString("en-IN") })
          });
          await sendMessage(chatId, `✅ നോട്ട് സേവ് ചെയ്തു: **${nTitle.trim()}**`);
          return res.status(200).send("OK");
        }
      }

      // Debt save cheyyunnathe check cheyyan (e.g., debt: name give/get amount)
      if (userText.toLowerCase().startsWith("debt:")) {
        const debtPart = userText.replace(/^debt:/i, "").trim();
        // Simple parsing
        await fetch(`${DB_URL}/debts.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person: debtPart, date: new Date().toLocaleDateString("en-IN") })
        });
        await sendMessage(chatId, `✅ കടം / കണക്ക് സേവ് ചെയ്തു: **${debtPart}**`);
        return res.status(200).send("OK");
      }

      // Fetch saved data from Firebase for AI search
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
      You are Haleel's personal assistant & digital locker bot working entirely inside Telegram chat.
      Here is Haleel's saved data from Firebase:
      - Saved Files (Certificates & Kitabs): ${JSON.stringify(allFiles.map(f => f.title))}
      - Secret Notes & IDs: ${JSON.stringify(notes)}
      - Money / Debts: ${JSON.stringify(debts)}
      - Reminders: ${JSON.stringify(reminders)}

      User message: "${userText}"

      STRICT RULES:
      1. If the user is asking for a saved certificate, document, or kitab/book from the "Saved Files" list, reply ONLY with: SEND_FILE:<exact_title_from_list>
      2. If the user is asking about a saved note, ID, password, money/debt calculation, or reminder, answer clearly and accurately in Malayalam using the data above.
      3. Otherwise, reply helpfully and concisely in Malayalam as Haleel's smart personal staff.
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
