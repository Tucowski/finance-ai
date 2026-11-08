# FinanceAI 📈🤖

Aplicação web que reúne **conversor de moedas**, **cotações da bolsa (B3)** e um **assistente financeiro com IA** que responde perguntas usando as cotações exibidas na tela.

> Projeto de portfólio feito com HTML, CSS, JavaScript puro e um servidor Node.js sem dependências.

## Funcionalidades

- Conversor entre BRL, USD, EUR, GBP, ARS e BTC, com botão de inverter moedas
- Cotações de câmbio atualizadas a cada minuto (AwesomeAPI)
- Cotações de ações da B3 (brapi.dev)
- Chat com IA (Google Gemini no plano gratuito, ou Claude como alternativa) que recebe o contexto de mercado atual e explica conceitos de forma didática
- Respostas educacionais, sem recomendação de compra ou venda

## Como a IA foi integrada

A chave da API **nunca vai para o navegador**. O frontend chama `POST /api/chat` no servidor, e o `server.js` faz a requisição para o provedor de IA: o **Google Gemini** (plano gratuito) quando `GEMINI_API_KEY` está definida, ou a **API da Anthropic** quando só `ANTHROPIC_API_KEY` está definida. O servidor também:

- limita o histórico às últimas 10 mensagens e o tamanho de cada texto
- aplica limite de requisições por IP (15 por minuto)
- define um *system prompt* que mantém o assistente em português e educacional
- injeta no prompt os dados de mercado que o usuário está vendo

## Como rodar

Requisitos: Node.js 20 ou superior e uma chave de API gratuita do [Google AI Studio](https://aistudio.google.com/) (ou uma chave da Anthropic).

```bash
git clone https://github.com/SEU-USUARIO/finance-ai.git
cd finance-ai
cp .env.example .env      # edite e preencha GEMINI_API_KEY
npm start
```

Abra http://localhost:3000.

## Estrutura

```
finance-ai/
├── server.js          # servidor HTTP + proxy seguro para a IA
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js         # conversor, cotações e chat
├── .env.example
└── package.json
```

## Próximos passos

- Gráfico histórico das cotações
- Respostas da IA em streaming
- Deploy (Render ou Railway) com a chave em variável de ambiente

## Aviso

Projeto educacional. Os dados têm atraso e nada aqui é recomendação de investimento.

## Licença

MIT
