import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import pkg from "pg";
import cors from "cors";

// allow only your frontend domain
const allowedOrigins = [
  "https://k-smith-bot.netlify.app" // replace with actual Netlify URL
];

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(bodyParser.json());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Supabase Postgres connection
const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: {
    rejectUnauthorized: false, // required by Supabase
  },
});

// Global set of IDs already returned
// const usedChunkIds = new Set();
const usedChunkIds = [];

// --- RAG endpoint ---
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // 1. Embed user query
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });




    // const queryEmbedding = emb.data[0].embedding;
    //
    // // 2. Query Postgres with pgvector
    // const { rows } = await pool.query(
    //   `select id, content, 1 - (embedding <=> $1::vector) as similarity
    //    from book_chunks2
    //    order by embedding <=> $1::vector
    //    limit 5;`,
    //   [queryEmbedding]
    // );


    const queryEmbedding = emb.data[0].embedding;
    const vectorStr = `[${queryEmbedding.join(",")}]`; // Postgres vector literal

    // 2. Build query, exclude already used IDs
    const usedIdsArray = Array.from(usedChunkIds).map(Number);

    console.log({ usedIdsArray })

    let query, params;

    if (usedIdsArray.length === 0) {
      query = `
        SELECT id, content
        FROM book_chunks3
        ORDER BY embedding <=> $1::vector
        LIMIT 1
      `;
      params = [vectorStr];
    } else {
      query = `
        SELECT id, content
        FROM book_chunks3
        WHERE id != ALL($2::bigint[])
        ORDER BY embedding <=> $1::vector
        LIMIT 1
      `;
      params = [vectorStr, usedIdsArray];
    }

    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      return res.json({ reply: "No new relevant information left in the book." });
    }

    // 3. Mark these chunks as used globally
    // rows.forEach(r => usedChunkIds.add(r.id));
    rows.forEach(r => usedChunkIds.push(r.id));


    const contextFORLOGGING = rows.map((r) => r.content).join("\n\n\n\n\n\n\n\n\n\n\n\n");

    console.log({ contextFORLOGGING })



    const context = rows.map(r => r.content).join("\n");



    // const message1 = 'Context';
    // const message1 = 'Keep this in mind'
    // const message1 = 'Keep this information in mind'
    const message1 = 'Potentially useful information'

    // const message2 = `Question`;
    // const message2 = `User message`;
    const message2 = `New user message`;

    const gptContent = `${message1}:\n${context}\n\n${message2}:\n${message}`;

    // console.log({ gptContent })

    // 5. Ask GPT-4.1



    // console.log({ gptContent })
    res.json({ reply: gptContent });


    // // 4. Ask GPT-4.1
    // const completion = await openai.chat.completions.create({
    //   model: "gpt-4.1",
    //   messages: [
    //     { role: "system", content: "You are Kaylie Smith, the author of the book Phantasma. You answer questions about the Phantasma book based on the provided Phantasma book snippets. Talk passionately as if the information is coming from your head. Do not mention that you had context given to you." },
    //     { role: "user", content: gptContent }
    //   ]
    // });

    // console.log({ completionChoices: completion.choices })

    // const reply = completion.choices[0].message.content;
    // res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
