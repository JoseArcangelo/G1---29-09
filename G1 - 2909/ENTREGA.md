# Entrega — Sensor de Ocupação de Sala (IoT)

**Aluno:** José Arcangelo de Souza Garlet
**Disciplina:** IoT (Internet of Things)
**Professor:** Prof. Leonam V. Hemann

## Links

- **Projeto Wokwi:** https://wokwi.com/projects/476540266106115073
- **URL do Worker:** https://sensor-sala.jose-arcangelo.workers.dev

## Endpoints

| Método | Endpoint | Função |
|---|---|---|
| POST | `/movimento` | Registra um movimento (ts gerado no Worker) |
| POST | `/luz` | Registra leitura de luz `{ "valor": 1001, "acesa": 1 }` |
| GET | `/ultimo-movimento` | Segundos desde o último movimento |
| GET | `/por-hora` | Movimentos por hora do dia (horário de Brasília) |
| GET | `/luz-resumo` | Total de leituras, quantas com luz acesa e percentual |
| GET | `/desperdicio` | Leituras com luz acesa sem movimento nos 2 min anteriores |

## Limiar de luz (R1)

Leituras do LDR no GPIO 34 (`analogRead`, 0 a 4095):

| Situação | Leitura |
|---|---|
| Luz alta (lux máximo) | 95 |
| Luz padrão (~500 lux) | 1001 |
| Escuro (0.1 lux) | 4032 |

No módulo LDR do Wokwi, **mais luz gera valor menor**. Definido **LIMIAR_LUZ = 2000**:
leitura **< 2000 → luz acesa**, leitura **≥ 2000 → luz apagada**.

## Lógica do ESP32 (resumo)

- **R2:** `attachInterrupt(digitalPinToInterrupt(27), isrMovimento, RISING)`. A ISR só incrementa um contador `volatile`; o `loop()` compara com os eventos já processados e envia um `POST /movimento` para cada um, então nenhum movimento se perde durante um envio HTTP.
- **R3:** LED aceso por 30 s após o último movimento (tempo reinicia a cada movimento, via `millis()`). Sala vazia com luz acesa por mais de 60 s → LED pisca (alerta de desperdício).
- **R4:** `POST /luz` a cada 20 s com `{ "valor": <leitura>, "acesa": 0|1 }`, via HTTPS (`WiFiClientSecure` + `setInsecure()`).
- **R7:** Serial mostra cada movimento (total acumulado), leitura de luz, estado da sala e código HTTP de cada envio.

## CREATE TABLE (D1)

```sql
CREATE TABLE IF NOT EXISTS movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS luz (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  valor INTEGER NOT NULL,
  acesa INTEGER NOT NULL CHECK (acesa IN (0, 1)),
  ts INTEGER NOT NULL
);
```

Inserções no Worker (sempre `prepare` + `bind`, `ts` gerado com `Date.now()` em ms):

```js
env.DB.prepare("INSERT INTO movimentos (ts) VALUES (?)").bind(ts).run();
env.DB.prepare("INSERT INTO luz (valor, acesa, ts) VALUES (?, ?, ?)").bind(valor, acesa, ts).run();
```

## Consultas SQL

### /ultimo-movimento
```sql
SELECT MAX(ts) AS ts FROM movimentos;
-- segundos = (Date.now() - ts) / 1000, calculado no Worker
```

### /por-hora
```sql
SELECT strftime('%H', ts / 1000, 'unixepoch', '-3 hours') AS hora,
       COUNT(*) AS movimentos
  FROM movimentos
 GROUP BY hora
 ORDER BY hora;
```

### /luz-resumo
```sql
SELECT COUNT(*) AS total,
       COALESCE(SUM(acesa), 0) AS acesas
  FROM luz;
-- percentual = acesas * 100 / total, calculado no Worker
```

### /desperdicio
```sql
SELECT COUNT(*) AS total
  FROM luz
 WHERE acesa = 1
   AND NOT EXISTS (
     SELECT 1 FROM movimentos m
      WHERE m.ts BETWEEN luz.ts - 120000 AND luz.ts
   );
```

## Prints

### 1. Serial Monitor (movimento, estado da sala e HTTP 201)
Sequência VAZIA → OCUPADA → VAZIA → DESPERDICIO, com todos os envios retornando HTTP 201.

![Serial Monitor](<print1.png>)

### 2. GET /ultimo-movimento
Resultado: `{"segundos":197,"ultimo_ts":1790723970452}`, ou seja, o último movimento ocorreu há 197 s.

![/ultimo-movimento](<print 2.png>)

### 3. GET /por-hora
Resultado: `[{"hora":"20","movimentos":3}]`, com 3 movimentos às 20h (horário de Brasília).

![/por-hora](<print 3.png>)

### 4. GET /luz-resumo
Resultado: `{"total":18,"acesas":16,"percentual_acesa":88.9}`, ou seja, 16 de 18 leituras com luz acesa (88,9%).

![/luz-resumo](<print 4.png>)

### 5. GET /desperdicio
Resultado: `{"leituras_desperdicio":11,"janela_minutos":2}`, ou seja, 11 leituras com luz acesa sem movimento nos 2 minutos anteriores.

![/desperdicio](<print 5.png>)
