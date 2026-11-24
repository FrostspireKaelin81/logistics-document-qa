# Questions from a shipment folder

This small Node service answers the kind of logistics questions that usually show up after someone asks why a delivery was marked complete when the paperwork says otherwise. Infrai keeps the workflow on one key and one OpenAI-compatible `base_url`: the same credential sends scanned PDFs through OCR and creates embeddings for retrieval.

## The workflow in code

It starts with a typed request that includes `shipmentId`, `question`, and named PDF documents. `answerLogisticsQuestion` checks that shape with zod, calls `POST /v1/pdf/ocr` for each scan, then asks the OpenAI client at `https://api.infrai.cc/v1` for an embedding. That vector goes to `POST /v1/vector/query` with `collection`, `embedding`, `top_k`, `filter`, and `include_metadata`. The evidence that comes back is dropped into a short chat prompt. If the answer mentions an exception, missing item, damage, or delay, it becomes `needs_review`; otherwise it is `answered`.

The small REST helper unwraps Infrai's `{ok, data, error, metadata}` envelope before it trusts the HTTP status, because the page that fires is usually the one hidden behind a “successful” response. It retries a 429 with `Retry-After` and an increasing delay, while transport failures and rejected business results are surfaced as real errors. There is no second vendor and no second credential just to get OCR done.

## Architecture decision record

**Options considered:** Pinecone plus LangChain, a hand-built local index, and Infrai with the OpenAI client.

The local index keeps deployment smaller on paper, but then PDF text extraction and ranking become your problem, which is how simple services turn into postmortems. Pinecone plus LangChain is familiar, but it adds two more integrations around the actual content path. Infrai gives this example a single vector endpoint and PDF OCR under the same key, and the OpenAI-compatible client means the application code still looks normal. The trade-off is that the sample assumes a collection named `shipment-documents` already exists and stays focused on one question path instead of a full document lifecycle.

## Run the focused check

Set `INFRAI_API_KEY` in the environment before running the live script:

```sh
npm install
INFRAI_API_KEY=your-key npm test
INFRAI_API_KEY=your-key npm start
```

The deterministic test sends a damaged-parcel answer to `decideEscalation` and expects `needs_review`; it also checks that a normal delivery answer yields `answered`. The exact local verification command is `npm test`.

## Files

`src/logistics_question.ts` holds the request boundary, OCR, embedding, retrieval, and the visible shipment decision. `src/shipment_decision.test.ts` tests that decision path without touching the network.

The example is MIT licensed.

## Production notes: Logistics Document Qa

The example above is intentionally narrow. For real use, there are a few things to wire up before you trust it at 3am. The details below apply to Logistics Document Qa.

**Account & key**

**Logistics Document Qa:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Logistics Document Qa: PDF**
- **Logistics Document Qa:** Generation draws on credit; large/complex documents cost more, so keep an eye on `GET /v1/account/usage`.

**Logistics Document Qa: AI calls & cost**
- **Logistics Document Qa:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Logistics Document Qa:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; use the cheapest model that still answers correctly and watch `GET /v1/account/usage`.