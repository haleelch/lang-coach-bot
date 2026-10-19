const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DB_URL = "https://digital-locker-7c539-default-rtdb.asia-southeast1.firebasedatabase.app";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).send("Telegram Digital Locker Bot is Active!");
  }

  try {
    const update = req.body;
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
          "⚠️ **Kripaya file-nte koode oru peru (Caption) koodi ezhuthi ayakku!**\n\n" +
          "• Certificate anel: Peru mathram ezhuthuka (Uda: `sslc`, `plus two`, `rc book`)\n" +
          "• Kitab anel: Thudakkathil `kitab:` ennu cherthu ezhuthuka (Uda: `kitab: Fathul Mueen`)"
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
      await sendMessage(chatId, `✅ **"${title}"** ningalude **${catName}**-lekku vijayakaramayi save cheythitundu! Ini chat-il ethu samayathum ithu chodichal njan eduthu tharam.`);
      return res.status(200).send("OK");
    }

    // 2. Chat-il text message ayakkumbol
    if (msg.text) {
      const userText = msg.text.trim();

      if (userText === "/start") {
        await sendMessage(
          chatId,
          "👋 **Swagatham Haleel! Ningalude Personal Staff & Digital Locker ready aanu.**\n\n" +
          "🔹 **File save cheyyan:** Ethu document-um photo-um perum (Caption) koode ezhuthi ingottu ayakkuka.\n" +
          "🔹 **Kitab save cheyyan:** PDF ayakkumbol `kitab: peru` ennu caption kodukkuka.\n" +
          "🔹 **Eduthu tharan:** Ethu file-inteyum note-inteyum peru veruthe chat-il chodikkuka, njan spottil thannicham!"
        );
        return res.status(200).send("OK");
      }

      // Fetch saved data from Firebase
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
          await sendFile(chatId, foundFile.fileId, foundFile.fileType, `📄 Intha ningalude **${foundFile.title}**`);
        } else {
          await sendMessage(chatId, `⚠️ Aa file kandethanayilla. Kripaya orikkal koodi caption ittu file ayakkuka.`);
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
