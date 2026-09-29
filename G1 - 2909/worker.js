// Cloudflare Worker — Sensor de ocupação de sala
// Binding D1 obrigatório com o nome: DB

const JANELA_DESPERDICIO_MS = 120000; // 2 minutos

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const metodo = request.method;

    try {
      // ---------- R4: POST /movimento ----------
      if (pathname === "/movimento") {
        if (metodo !== "POST") return json({ erro: "use POST" }, 405);
        const ts = Date.now();
        await env.DB.prepare("INSERT INTO movimentos (ts) VALUES (?)")
          .bind(ts)
          .run();
        return json({ ok: true, ts }, 201);
      }

      // ---------- R4: POST /luz ----------
      if (pathname === "/luz") {
        if (metodo !== "POST") return json({ erro: "use POST" }, 405);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ erro: "JSON inválido" }, 400);
        }
        const valor = Number(body.valor);
        const acesa = Number(body.acesa);
        if (!Number.isInteger(valor) || (acesa !== 0 && acesa !== 1)) {
          return json({ erro: "esperado { valor: inteiro, acesa: 0 ou 1 }" }, 400);
        }
        const ts = Date.now();
        await env.DB.prepare("INSERT INTO luz (valor, acesa, ts) VALUES (?, ?, ?)")
          .bind(valor, acesa, ts)
          .run();
        return json({ ok: true, ts }, 201);
      }

      if (metodo !== "GET") return json({ erro: "método não permitido" }, 405);

      // ---------- R6: GET /ultimo-movimento ----------
      if (pathname === "/ultimo-movimento") {
        const row = await env.DB.prepare("SELECT MAX(ts) AS ts FROM movimentos").first();
        if (!row || row.ts === null) {
          return json({ segundos: null, mensagem: "nenhum movimento registrado" });
        }
        return json({
          segundos: Math.floor((Date.now() - row.ts) / 1000),
          ultimo_ts: row.ts,
        });
      }

      // ---------- R6: GET /por-hora ----------
      if (pathname === "/por-hora") {
        const { results } = await env.DB.prepare(
          `SELECT strftime('%H', ts / 1000, 'unixepoch', '-3 hours') AS hora,
                  COUNT(*) AS movimentos
             FROM movimentos
            GROUP BY hora
            ORDER BY hora`
        ).all();
        return json(results);
      }

      // ---------- R6: GET /luz-resumo ----------
      if (pathname === "/luz-resumo") {
        const row = await env.DB.prepare(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(acesa), 0) AS acesas
             FROM luz`
        ).first();
        const percentual = row.total ? Math.round((row.acesas * 1000) / row.total) / 10 : 0;
        return json({ total: row.total, acesas: row.acesas, percentual_acesa: percentual });
      }

      // ---------- R6: GET /desperdicio ----------
      if (pathname === "/desperdicio") {
        const row = await env.DB.prepare(
          `SELECT COUNT(*) AS total
             FROM luz
            WHERE acesa = 1
              AND NOT EXISTS (
                SELECT 1 FROM movimentos m
                 WHERE m.ts BETWEEN luz.ts - ? AND luz.ts
              )`
        )
          .bind(JANELA_DESPERDICIO_MS)
          .first();
        return json({ leituras_desperdicio: row.total, janela_minutos: 2 });
      }

      return json({ erro: "rota não encontrada" }, 404);
    } catch (e) {
      return json({ erro: "erro interno", detalhe: String(e) }, 500);
    }
  },
};
