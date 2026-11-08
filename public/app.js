// ===== Dados de câmbio (AwesomeAPI) =====
const FX_PAIRS = ["USD-BRL", "EUR-BRL", "GBP-BRL", "BTC-BRL", "ARS-BRL"];
const CURRENCIES = ["BRL", "USD", "EUR", "GBP", "ARS", "BTC"];
const STOCKS = ["PETR4", "VALE3", "ITUB4", "BBDC4", "MGLU3"];

const state = { fx: {}, stocks: [], messages: [] };

const $ = (id) => document.getElementById(id);
const brl = (n, d = 2) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: d });

function variationHtml(pct) {
  const v = Number(pct);
  const cls = v >= 0 ? "up" : "down";
  const arrow = v >= 0 ? "▲" : "▼";
  return `<span class="${cls}">${arrow} ${Math.abs(v).toFixed(2)}%</span>`;
}

async function loadFx() {
  try {
    const res = await fetch(`https://economia.awesomeapi.com.br/json/last/${FX_PAIRS.join(",")}`);
    const data = await res.json();
    state.fx = {};
    $("fx-list").innerHTML = FX_PAIRS.map((pair) => {
      const q = data[pair.replace("-", "")];
      state.fx[q.code] = Number(q.bid);
      return `<li>
        <span class="name">${q.name.split("/")[0]}</span>
        <span class="price">${brl(q.bid, q.code === "BTC" ? 0 : 2)}<br>${variationHtml(q.pctChange)}</span>
      </li>`;
    }).join("");
    state.fxRaw = data;
    convert();
  } catch {
    $("fx-list").innerHTML = '<li class="muted">Não foi possível carregar o câmbio.</li>';
  }
}

async function loadStocks() {
  try {
    const res = await fetch(`https://brapi.dev/api/quote/${STOCKS.join(",")}`);
    const data = await res.json();
    state.stocks = data.results || [];
    $("stocks-list").innerHTML = state.stocks
      .map(
        (s) => `<li>
          <span class="name">${s.symbol}</span>
          <span class="price">${brl(s.regularMarketPrice)}<br>${variationHtml(s.regularMarketChangePercent)}</span>
        </li>`
      )
      .join("");
  } catch {
    $("stocks-list").innerHTML = '<li class="muted">Não foi possível carregar a bolsa agora.</li>';
  }
}

// ===== Conversor =====
function toBrl(code) {
  return code === "BRL" ? 1 : state.fx[code];
}

function convert() {
  const amount = parseFloat($("amount").value);
  const from = $("from").value;
  const to = $("to").value;
  const a = toBrl(from);
  const b = toBrl(to);
  if (!amount || !a || !b) {
    $("result").textContent = "—";
    $("rate-info").textContent = "";
    return;
  }
  const rate = a / b;
  const value = amount * rate;
  const digits = to === "BTC" ? 8 : 2;
  $("result").textContent = `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })} ${to}`;
  $("rate-info").textContent = `1 ${from} = ${rate.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${to}`;
}

function initConverter() {
  for (const id of ["from", "to"]) {
    $(id).innerHTML = CURRENCIES.map((c) => `<option>${c}</option>`).join("");
  }
  $("from").value = "USD";
  $("to").value = "BRL";
  $("amount").addEventListener("input", convert);
  $("from").addEventListener("change", convert);
  $("to").addEventListener("change", convert);
  $("swap").addEventListener("click", () => {
    const f = $("from").value;
    $("from").value = $("to").value;
    $("to").value = f;
    convert();
  });
}

// ===== Chat com IA =====
function marketContext() {
  const fx = Object.entries(state.fx)
    .map(([code, v]) => {
      const q = state.fxRaw?.[`${code}BRL`];
      return `${code}/BRL: ${v.toFixed(2)}${q ? ` (variação ${q.pctChange}%)` : ""}`;
    })
    .join("\n");
  const stocks = state.stocks
    .map((s) => `${s.symbol}: R$ ${s.regularMarketPrice} (variação ${Number(s.regularMarketChangePercent).toFixed(2)}%)`)
    .join("\n");
  return `Câmbio:\n${fx}\n\nAções:\n${stocks}`;
}

function addMessage(role, text, extraClass = "") {
  const div = document.createElement("div");
  div.className = `msg ${role} ${extraClass}`.trim();
  div.textContent = text;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
  return div;
}

async function ask(text) {
  addMessage("user", text);
  state.messages.push({ role: "user", content: text });
  const typing = addMessage("bot", "Pensando…");
  $("send").disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages, marketContext: marketContext() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro desconhecido");
    typing.textContent = data.reply;
    state.messages.push({ role: "assistant", content: data.reply });
  } catch (err) {
    typing.textContent = err.message;
    typing.classList.add("error");
    state.messages.pop(); // remove a pergunta que falhou do histórico
  } finally {
    $("send").disabled = false;
    $("messages").scrollTop = $("messages").scrollHeight;
  }
}

function initChat() {
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chat-input").value.trim();
    if (!text) return;
    $("chat-input").value = "";
    ask(text);
  });
  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => ask(chip.textContent))
  );
}

// ===== Início =====
initConverter();
initChat();
loadFx();
loadStocks();
setInterval(loadFx, 60_000);
setInterval(loadStocks, 120_000);
