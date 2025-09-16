import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import pkg from "pg";
import cors from "cors";

dotenv.config();
const { Pool } = pkg;

const allowedOrigins = [
  "https://k-smith-bot.netlify.app"
];

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
});

const app = express();
app.use(bodyParser.json());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- RAG endpoint ---
app.post("/chat", async (req, res) => {
  try {
    const { message, usedChunkIds = [] } = req.body;

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
    //    from book_chunks3
    //    order by embedding <=> $1::vector
    //    limit 5;`,
    //   [queryEmbedding]
    // );


    const queryEmbedding = emb.data[0].embedding; // array of numbers
    const vectorStr = `[${queryEmbedding.join(",")}]`; // pgvector literal
    const usedIdsArray = usedChunkIds.map(id => Number(id));

    // 2. Build SQL query
    let query, params;
    if (usedIdsArray.length === 0) {
      query = `
        SELECT id, content
        FROM book_chunks3
        ORDER BY embedding <=> $1::vector
        LIMIT 5
      `;
      params = [vectorStr];
    } else {
      query = `
        SELECT id, content
        FROM book_chunks3
        WHERE id != ALL($2::bigint[])
        ORDER BY embedding <=> $1::vector
        LIMIT 5
      `;
      params = [vectorStr, usedIdsArray];
    }

    // 3. Execute query
    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      return res.json({ reply: "No new relevant information left in the book.", newUsedIds: [] });
    }

    // 4. Return the results and update used IDs
    const newUsedIds = rows.map(r => r.id);
    const context = rows.map(r => r.content).join("\n");

    // const message1 = 'Context';
    // const message1 = 'Keep this in mind'
    // const message1 = 'Keep this information in mind'
    // const message1 = 'Potentially useful information'
    const message1 = 'Potentially helpful quotes'

    // const message2 = `Question`;
    // const message2 = `User message`;
    const message2 = `New user message`;

    const gptContent = `${message1}:\n${context}\n\n${message2}:\n${message}`;

    res.json({ reply: gptContent, newUsedIds });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
