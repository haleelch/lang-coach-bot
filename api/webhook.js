const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DB_URL = "https://digital-locker-7c539-default-rtdb.asia-southeast1.firebasedatabase.app";

// Temporary memory to track unlocked users (Chat ID -> Unlocked status)
const unlockedUsers = new Set();

const SECRET_PIN = "6391";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).send("Telegram Digital Locker Bot is Active!");
  }

  try {
    const update = req.body;
    
    if (update.callback_query) {
      const q = update.callback_query;
      const chatId = q.message.chat.id;
      
      if (!unlockedUsers.has(chatId)) {
        await sendMessage(chatId, "🔒 <b>Locked! Please enter your PIN (e.g. 6391) to unlock:</b>");
        return res.status(200).send("OK");
      }

      const data = q.data;

      if (data === "menu_certs") {
        await sendMessage(chatId, "<b>Certificates Section</b>\n\nSend your certificate photo or PDF with a caption name (e.g., SSLC).");
      } else if (data === "menu_library") {
        await sendMessage(chatId, "<b>Kitab Library Section</b>\n\nSend your PDF book with the caption: <code>kitab: Book Name</code>");
      } else if (data === "menu_notes") {
        await sendMessage(chatId, "<b>Secret Notes & IDs</b>\n\nTo save a note, type:\n<code>note: Title - Your content here</code>");
      } else if (data === "menu_money") {
        await sendMessage(chatId, "<b>Money Tracker</b>\n\nTo save a record, type:\n<code>debt: Name give/get amount</code>");
      }

      return res.status(200).send("OK");
    }

    if (!update.message) return res.status(200).send("OK");

    const chatId = update.message.chat.id;
    const msg = update.message;
    const userText = (msg.text || "").trim();

    // Check if user is trying to unlock with PIN
    if (userText === SECRET_PIN) {
      unlockedUsers.add(chatId);
      await sendMessage(chatId, "🔓 <b>Unlocked successfully! Welcome Haleel.</b>\n\nType /start to open the menu.");
      return res.status(200).send("OK");
    }

    // If not unlocked, demand PIN
    if (!unlockedUsers.has(chatId)) {
      await sendMessage(chatId, "🔒 <b>Access Locked!</b>\nPlease enter your 4-digit secret PIN to continue:");
      return res.status(200).send("OK");
    }

    // Lock command if user wants to lock it back
    if (userText.toLowerCase() === "/lock") {
      unlockedUsers.delete(chatId);
      await sendMessage(chatId, "🔒 <b>Bot locked successfully!</b>");
      return res.status(200).send("OK");
    }

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
          "⚠️ <b>Please send a name (Caption) along with the file!</b>\n\n" +
          "• For Certificate: Just write the name (e.g., <code>sslc</code>)\n" +
          "• For Kitab: Start with <code>kitab:</code> (e.g., <code>kitab: Fathul Mueen</code>)"
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

      const catName = category === "library" ? "Kitab Library" : "Certificates";
      await sendMessage(chatId, `✅ <b>"${title}"</b> successfully saved to your <b>${catName}</b>!`);
      return res.status(200).send("OK");
    }

    if (msg.text) {
      if (userText === "/start" || userText.toLowerCase() === "menu") {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "<b>Welcome Haleel</b>",
            parse_mode: "HTML",
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
          await sendMessage(chatId, `✅ Note saved: <b>${nTitle.trim()}</b>`);
          return res.status(200).send("OK");
        }
      }

      if (userText.toLowerCase().startsWith("debt:")) {
        const debtPart = userText.replace(/^debt:/i, "").trim();
        await fetch(`${DB_URL}/debts.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person: debtPart, date: new Date().toLocaleDateString("en-IN") })
        });
        await sendMessage(chatId, `✅ Record saved: <b>${debtPart}</b>`);
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
      You are Haleel's personal assistant & digital locker bot working entirely inside Telegram chat.
      Here is Haleel's saved data from Firebase:
      - Saved Files (Certificates & Kitabs): ${JSON.stringify(allFiles.map(f => f.title))}
      - Secret Notes & IDs: ${JSON.stringify(notes)}
      - Money / Debts: ${JSON.stringify(debts)}
      - Reminders: ${JSON.stringify(reminders)}

      User message: "${userText}"

      STRICT RULES:
      1. If the user is asking for a saved certificate, document, or kitab/book from the "Saved Files" list, reply ONLY with: SEND_FILE:<exact_title_from_list>
      2. If the user is asking about a saved note, ID, password, money/debt calculation, or reminder, answer clearly and accurately using the data above.
      3. Otherwise, reply helpfully and concisely as Haleel's smart personal staff.
      `;

      const result = await model.generateContent(prompt);
      const aiReply = result.response.text().trim();

      if (aiReply.startsWith("SEND_FILE:")) {
        const targetTitle = aiReply.replace("SEND_FILE:", "").trim().toLowerCase();
        const foundFile = allFiles.find(f => f.title.toLowerCase() === targetTitle || f.title.toLowerCase().includes(targetTitle));

        if (foundFile) {
          await sendFile(chatId, foundFile.fileId, foundFile.fileType, `📄 Here is your <b>${foundFile.title}</b>`);
        } else {
          await sendMessage(chatId, `⚠️ File not found. Please send it again with a valid caption.`);
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
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function sendFile(chatId, fileId, type, caption) {
  const endpoint = type === "photo" ? "sendPhoto" : "sendDocument";
  const body = { chat_id: chatId, caption, parse_mode: "HTML" };
  body[type] = fileId;

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
