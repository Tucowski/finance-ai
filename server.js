// Servidor sem dependências externas (apenas Node 20+).
// Serve o frontend e faz a ponte com a API da IA, mantendo a chave fora do navegador.
const http = require("http");
const fs = require("fs");
const path = require("path");

// Carrega variáveis do arquivo .env (sem precisar do pacote dotenv)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    // Remove espaços e aspas ao redor do valor (ex.: KEY="abc" vira abc)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
// Garante que as chaves não tenham espaços ou quebras de linha copiadas por engano
for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) {
  if (process.env[k]) process.env[k] = process.env[k].trim().replace(/^["']|["']$/g, "");
}

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const SYSTEM_PROMPT = `Você é o assistente financeiro de um app educacional de cotações.
Responda sempre em português do Brasil, de forma clara, curta e didática.
Use os dados de mercado enviados no contexto quando forem relevantes e diga quando não tiver um dado.
Explique conceitos (câmbio, variação, volatilidade, ações, dividendos) de forma simples.
Você NÃO dá recomendação de compra ou venda: deixe claro que o conteúdo é educacional
e não é aconselhamento financeiro.`;

// Limite simples de requisições por IP (proteção básica contra abuso)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 15;
}

function readBody(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error("Corpo da requisição muito grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

// Provedor de IA: usa o Gemini (plano gratuito) se GEMINI_API_KEY existir;
// caso contrário, usa a API da Anthropic.
class AiError extends Error {}

async function callGemini(system, messages) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 600 },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error("Erro do Gemini:", data);
    throw new AiError(data.error?.message || "Erro ao consultar a IA.");
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  const reply = parts.map((p) => p.text || "").join("\n").trim();
  if (!reply) throw new AiError("A IA não devolveu resposta. Tente reformular a pergunta.");
  return reply;
}

async function callAnthropic(system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, system, messages }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Erro da API:", data);
    throw new AiError(data.error?.message || "Erro ao consultar a IA.");
  }
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

async function handleChat(req, res) {
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return sendJson(res, 500, {
      error: "Nenhuma chave de IA configurada. Defina GEMINI_API_KEY (gratuita) ou ANTHROPIC_API_KEY no .env.",
    });
  }
  if (rateLimited(req.socket.remoteAddress)) {
    return sendJson(res, 429, { error: "Muitas perguntas seguidas. Aguarde um minuto." });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "JSON inválido." });
  }

  const { messages, marketContext } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return sendJson(res, 400, { error: "Envie ao menos uma mensagem." });
  }

  // Sanitiza o histórico: apenas as últimas 10 mensagens, texto limitado
  const clean = messages
    .slice(-10)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (clean.length === 0 || clean[0].role !== "user") {
    return sendJson(res, 400, { error: "A conversa deve começar com uma mensagem do usuário." });
  }

  const system =
    SYSTEM_PROMPT +
    (marketContext
      ? `\n\nDados de mercado atuais exibidos na tela do usuário:\n${String(marketContext).slice(0, 3000)}`
      : "");

  try {
    const reply = process.env.GEMINI_API_KEY
      ? await callGemini(system, clean)
      : await callAnthropic(system, clean);
    sendJson(res, 200, { reply });
  } catch (err) {
    console.error(err);
    sendJson(res, 502, {
      error: err instanceof AiError ? err.message : "Não foi possível falar com a IA agora.",
    });
  }
}

function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Proibido");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Não encontrado");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405);
    res.end();
  })
  .listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
