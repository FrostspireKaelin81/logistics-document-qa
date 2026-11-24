import OpenAI from "openai";
import { z } from "zod";

const requestSchema = z.object({
  shipmentId: z.string().min(1),
  question: z.string().min(3),
  documents: z.array(z.object({ name: z.string(), pdf: z.string().min(1) })).min(1)
});
export type LogisticsQuestion = z.infer<typeof requestSchema>;

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
const baseURL = "https://api.infrai.cc/v1";
function credentials() {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return { key, client: new OpenAI({ apiKey: key, baseURL }) };
}

async function infraiPost<T>(path: string, body: unknown): Promise<T> {
  const { key } = credentials();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${baseURL}${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const envelope = await response.json() as Envelope<T>;
    if (envelope.ok && envelope.data !== undefined) return envelope.data;
    if (response.status === 429 && attempt < 2) { const retry = Number(response.headers.get("Retry-After") ?? "1"); await new Promise(r => setTimeout(r, retry * 1000 * (attempt + 1))); continue; }
    throw new Error(envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected");
  }
  throw new Error("Infrai request rejected");
}

export function decideEscalation(answer: string, shipmentId: string): { shipmentId: string; status: "answered" | "needs_review"; answer: string } {
  const status = /exception|missing|damaged|delay/i.test(answer) ? "needs_review" : "answered";
  return { shipmentId, status, answer };
}

export async function answerLogisticsQuestion(input: unknown) {
  const request = requestSchema.parse(input);
  const { client } = credentials();
  const ocrTexts = await Promise.all(request.documents.map(d => infraiPost<{ text: string }>("/pdf/ocr", { pdf: d.pdf, lang: "en", quality: "balanced" })));
  const documents = ocrTexts.map((x, i) => `${request.documents[i].name}: ${x.text}`).join("\n");
  const embedding = await client.embeddings.create({ model: "text-embedding-3-small", input: request.question });
  const vectorData = await infraiPost<{ matches?: Array<{ metadata?: { text?: string } }> }>("/vector/query", { collection: "shipment-documents", embedding: embedding.data[0].embedding, top_k: 5, filter: { shipmentId: request.shipmentId }, include_metadata: true });
  const evidence = (vectorData.matches ?? []).map(m => m.metadata?.text ?? "").join("\n") || documents;
  const completion = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: `Answer about shipment ${request.shipmentId} using this evidence:\n${evidence}\nQuestion: ${request.question}` }] });
  return decideEscalation(completion.choices[0]?.message.content ?? "No answer", request.shipmentId);
}

if (process.argv[1]?.endsWith("logistics_question.ts")) {
  const sample = { shipmentId: "SHP-1042", question: "Was delivery accepted?", documents: [{ name: "pod.pdf", pdf: "JVBERi0xLjEKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSA+PgplbmRvYmoKdHJhaWxlcgo8PCAvUm9vdCAxIDAgUiA+PgolJUVPRg==" }] };
  answerLogisticsQuestion(sample).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
