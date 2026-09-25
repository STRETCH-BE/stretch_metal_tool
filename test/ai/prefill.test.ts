/**
 * prefillFromPdf with @anthropic-ai/sdk mocked: no key → null, a tool_use
 * answer → sanitised + merged Suggestions, anything else → heuristic
 * fallback with the "ai_unavailable" note. Also pins the request shape
 * (document block, forced tool choice, timeout) and keeps the tool schema
 * in sync with the zod schema.
 * File path: /test/ai/prefill.test.ts
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, ctorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  ctorMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "APIError";
      this.status = status;
    }
  }
  class MockAnthropic {
    static APIError = APIError;
    messages = { create: createMock };
    constructor(options: unknown) {
      ctorMock(options);
    }
  }
  return { default: MockAnthropic, APIError };
});

import {
  AI_TIMEOUT_MS,
  DEFAULT_AI_MODEL,
  MAX_DOCUMENT_BYTES,
  SUGGESTION_TOOL_NAME,
  buildUserContent,
  mergeSuggestions,
  prefillFromPdf,
  resolveAiModel,
  suggestionTool,
  supportsForcedToolChoice,
} from "@/lib/ai/prefill";
import { heuristicSuggestions } from "@/lib/ai/heuristics";
import {
  AI_UNAVAILABLE_NOTE,
  PDF_TOO_LARGE_NOTE,
  hasNote,
  suggestionsSchema,
  textNote,
} from "@/lib/ai/types";

const TEXT = fs.readFileSync("test/fixtures/200005.pdf.txt", "utf8");
const PDF_BYTES = new Uint8Array(Buffer.from("%PDF-1.4 fake bytes"));

const AI_INPUT = {
  partNumber: "200005",
  material: "S355J2",
  materialFamily: "mild_steel",
  thicknessMm: 15,
  quantity: 25,
  weightKg: null,
  bends: null,
  threads: [
    { size: "M8", count: 8 },
    { size: "M10x1", count: 6 },
  ],
  finish: { code: "galvanised", ral: null, text: "ocynk ogniowy" },
  tolerances: null,
  notes: ["gwint M8 ×8"],
  confidence: "high",
  dimensionsMm: null,
};

function toolUseResponse(input: unknown, name = SUGGESTION_TOOL_NAME) {
  return {
    stop_reason: "tool_use",
    stop_details: null,
    content: [{ type: "tool_use", id: "toolu_1", name, input }],
  };
}

describe("prefillFromPdf", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createMock.mockReset();
    ctorMock.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("ANTHROPIC_MODEL", "");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
  });

  it("is a no-op (null) without ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await prefillFromPdf({ text: TEXT, partName: "200005.pdf", locale: "pl" });
    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("merges a tool_use answer over the heuristics (AI wins only where non-null)", async () => {
    createMock.mockResolvedValue(toolUseResponse(AI_INPUT));
    const result = await prefillFromPdf({
      pdfBytes: PDF_BYTES,
      text: TEXT,
      partName: "200005.pdf",
      locale: "pl",
    });
    expect(result).not.toBeNull();
    expect(result?.source).toBe("ai");
    expect(result?.model).toBe(DEFAULT_AI_MODEL);
    expect(result?.material).toBe("S355J2"); // AI overrides
    expect(result?.quantity).toBe(25); // AI only
    expect(result?.weightKg).toBe(11.69); // heuristic kept (AI null)
    expect(result?.tolerances).toContain("2768-mK"); // heuristic kept
    expect(result?.materialFamily).toBe("mild_steel");
    expect(result?.finish).toEqual({ code: "galvanised", ral: null, text: "ocynk ogniowy" });
    expect(result?.threads).toEqual(AI_INPUT.threads);
    expect(result?.confidence).toBe("high");
    // The model's free text becomes a "text" note in the request locale.
    expect(result?.notes[0]).toEqual(textNote("gwint M8 ×8"));
    expect(result?.notes).toContainEqual({ code: "hole", params: { callout: "Ø13 (6×)" } });
    expect(result && hasNote(result, AI_UNAVAILABLE_NOTE)).toBe(false);
    expect(result?.notes.some((n) => n.code === "ai_value_dropped")).toBe(false);
  });

  it("nulls out-of-range AI values, keeps the heuristic ones and says so (review finding)", async () => {
    createMock.mockResolvedValue(
      toolUseResponse({ ...AI_INPUT, quantity: 0, thicknessMm: -5, threads: [{ size: "banana", count: 2 }] })
    );
    const result = await prefillFromPdf({ text: TEXT, partName: "200005.pdf", locale: "pl" });
    expect(result?.source).toBe("ai");
    expect(result?.thicknessMm).toBe(15); // heuristic kept, AI -5 dropped
    expect(result?.quantity).toBeNull(); // AI 0 dropped, heuristic has none
    expect(result?.threads).toEqual([
      { size: "M8", count: 8 },
      { size: "M10x1", count: 6 },
    ]); // heuristic threads, "banana" dropped
    expect(result?.notes).toContainEqual({
      code: "ai_value_dropped",
      params: { field: "quantity", value: "0" },
    });
    expect(result?.notes).toContainEqual({
      code: "ai_value_dropped",
      params: { field: "thicknessMm", value: "-5" },
    });
    expect(result?.notes).toContainEqual({
      code: "ai_value_dropped",
      params: { field: "threads", value: "banana" },
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("adds the pdf_too_large note when the document block is skipped", async () => {
    createMock.mockResolvedValue(toolUseResponse(AI_INPUT));
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set(PDF_BYTES);
    const result = await prefillFromPdf({ pdfBytes: big, text: TEXT, partName: "200005.pdf", locale: "pl" });
    expect(result && hasNote(result, PDF_TOO_LARGE_NOTE)).toBe(true);
    const [params] = createMock.mock.calls[0];
    expect(params.messages[0].content.map((b: { type: string }) => b.type)).toEqual(["text"]);
  });

  it("sends the PDF as a document block, the text, one strict tool and a 30 s timeout", async () => {
    createMock.mockResolvedValue(toolUseResponse(AI_INPUT));
    await prefillFromPdf({ pdfBytes: PDF_BYTES, text: TEXT, partName: "200005.pdf", locale: "en" });

    expect(ctorMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-ant-test", timeout: AI_TIMEOUT_MS, maxRetries: 0 })
    );
    expect(AI_TIMEOUT_MS).toBe(30_000);

    const [params, options] = createMock.mock.calls[0];
    expect(options).toEqual({ timeout: AI_TIMEOUT_MS });
    expect(params.model).toBe(DEFAULT_AI_MODEL);
    expect(params.tools).toEqual([suggestionTool]);
    expect(suggestionTool.strict).toBe(true);
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: SUGGESTION_TOOL_NAME,
      disable_parallel_tool_use: true,
    });
    expect(params.system).toContain(SUGGESTION_TOOL_NAME);
    expect(params.messages).toHaveLength(1);
    const content = params.messages[0].content;
    expect(content[0]).toEqual({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: Buffer.from(PDF_BYTES).toString("base64"),
      },
      title: "200005.pdf",
    });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("PLECH 15x500x220");
  });

  it("omits the document block when no bytes are given", () => {
    const { content, documentSkipped } = buildUserContent({
      text: "S355",
      partName: "x.pdf",
      locale: "pl",
    });
    expect(documentSkipped).toBe(false);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
  });

  it("falls back to the heuristics with ai_unavailable on a malformed answer", async () => {
    createMock.mockResolvedValue(toolUseResponse({ ...AI_INPUT, thicknessMm: "fifteen" }));
    const result = await prefillFromPdf({ text: TEXT, partName: "200005.pdf", locale: "pl" });
    const heuristic = heuristicSuggestions(TEXT, "200005.pdf");
    expect(result?.source).toBe("heuristic");
    expect(result?.model).toBeNull();
    expect(result?.material).toBe("S355");
    expect(result?.thicknessMm).toBe(15);
    expect(result?.notes).toEqual([...heuristic.notes, { code: AI_UNAVAILABLE_NOTE }]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back when the model answers without the tool call", async () => {
    createMock.mockResolvedValue({
      stop_reason: "end_turn",
      stop_details: null,
      content: [{ type: "text", text: "I cannot read this." }],
    });
    const result = await prefillFromPdf({ text: TEXT, partName: "200005.pdf", locale: "pl" });
    expect(result?.source).toBe("heuristic");
    expect(result && hasNote(result, AI_UNAVAILABLE_NOTE)).toBe(true);
  });

  it("falls back on a refusal", async () => {
    createMock.mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: null },
      content: [],
    });
    const result = await prefillFromPdf({ text: TEXT, partName: "200005.pdf", locale: "pl" });
    expect(result && hasNote(result, AI_UNAVAILABLE_NOTE)).toBe(true);
    expect(errorSpy.mock.calls[0][0]).toContain("refusal");
  });

  it("falls back on an API error or timeout instead of throwing", async () => {
    createMock.mockRejectedValue(new Error("Request timed out."));
    const result = await prefillFromPdf({ text: TEXT, partName: "200005.pdf", locale: "pl" });
    expect(result?.source).toBe("heuristic");
    expect(result && hasNote(result, AI_UNAVAILABLE_NOTE)).toBe(true);
    expect(errorSpy.mock.calls[0][0]).toContain("Request timed out.");
  });

  it("honours ANTHROPIC_MODEL and switches to tool_choice auto where forcing is rejected", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-fable-5-1");
    expect(resolveAiModel()).toBe("claude-fable-5-1");
    expect(supportsForcedToolChoice("claude-fable-5-1")).toBe(false);
    expect(supportsForcedToolChoice("claude-opus-5-5")).toBe(false);
    expect(supportsForcedToolChoice(DEFAULT_AI_MODEL)).toBe(true);

    createMock.mockResolvedValue(toolUseResponse(AI_INPUT));
    const result = await prefillFromPdf({ text: TEXT, partName: "200005.pdf", locale: "pl" });
    expect(result?.model).toBe("claude-fable-5-1");
    const [params] = createMock.mock.calls[0];
    expect(params.model).toBe("claude-fable-5-1");
    expect(params.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  });
});

describe("suggestionTool schema", () => {
  it("lists exactly the Suggestions fields the model fills, all required", () => {
    const schema = suggestionTool.input_schema;
    const properties = Object.keys((schema.properties ?? {}) as Record<string, unknown>).sort();
    const zodKeys = Object.keys(suggestionsSchema.shape)
      .filter((k) => k !== "source" && k !== "model")
      .sort();
    expect(properties).toEqual(zodKeys);
    const required = [...(schema.required ?? [])].sort();
    expect(required).toEqual(zodKeys);
    expect(schema.additionalProperties).toBe(false);
  });

  it("carries the finish object and the material family enum (codes, not words)", () => {
    const props = suggestionTool.input_schema.properties as Record<string, unknown>;
    expect(JSON.stringify(props.finish)).toContain('"powder_coating"');
    expect(JSON.stringify(props.finish)).toContain('"ral"');
    expect(JSON.stringify(props.materialFamily)).toContain('"stainless"');
    // Strict tool schemas may not carry numeric bounds; the ranges live in bounds.ts.
    expect(JSON.stringify(suggestionTool.input_schema)).not.toMatch(/"(?:minimum|maximum)"/);
  });
});

describe("mergeSuggestions", () => {
  it("keeps heuristic threads and notes when the AI gives none", () => {
    const heuristic = heuristicSuggestions(TEXT, "200005.pdf");
    const ai = suggestionsSchema.parse({ ...AI_INPUT, threads: [], notes: [], material: null, finish: null });
    const merged = mergeSuggestions(heuristic, ai, "claude-opus-5");
    expect(merged.source).toBe("ai");
    expect(merged.model).toBe("claude-opus-5");
    expect(merged.threads).toEqual(heuristic.threads);
    expect(merged.material).toBe("S355");
    expect(merged.finish).toBeNull();
    expect(merged.notes).toEqual(heuristic.notes);
    expect(merged.dimensionsMm).toEqual({ length: 500, width: 220 });
  });
});
