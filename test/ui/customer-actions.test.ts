/**
 * Customer server actions — the useActionState reducers must echo the
 * submitted values on EVERY error (validation, forbidden, DB failure):
 * React 19 resets the <form> after the action settles, so without them a
 * single typo would wipe everything else the user typed. Supabase, auth,
 * audit and Next's cache/navigation are mocked; no network.
 * File path: /test/ui/customer-actions.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerRow } from "@/lib/db/types";

const { createClient, redirect, getCurrentUser, logAudit, revalidatePath } = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url: string) => {
    // Mirrors Next: redirect() never returns.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getCurrentUser: vi.fn(),
  logAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser,
  hasRole: (session: { profile: { role: string } } | null, roles: string[]) =>
    Boolean(session && roles.includes(session.profile.role)),
  WRITE_ROLES: ["admin", "sales"],
  ADMIN_ONLY: ["admin"],
}));

import { createCustomer, updateCustomer } from "@/lib/customers/actions";
import { INITIAL_CUSTOMER_FORM_STATE } from "@/lib/customers/schema";

const ID = "0b6d1c5e-9c3a-4f6e-8a2b-1d2e3f4a5b6c";

function session(role: "admin" | "sales" | "viewer") {
  return { user: { id: "user-1" }, profile: { role } };
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

type QueryResult = { data: CustomerRow | null; error: { message: string } | null };

/** Chainable PostgREST stub: every builder method returns the chain. */
function stubClient(results: { single?: QueryResult; maybeSingle?: QueryResult }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "insert", "select", "eq", "update", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => results.single ?? { data: null, error: null });
  chain.maybeSingle = vi.fn(async () => results.maybeSingle ?? { data: null, error: null });
  return chain;
}

const ROW: CustomerRow = {
  id: ID,
  name: "Acme GmbH",
  vat_id: "DE123456789",
  country: "DE",
  address: null,
  email: "buyer@acme.de",
  phone: null,
  customer_class: "key",
  preferred_locale: "en",
  notes: null,
  created_by: "user-1",
  created_at: "2026-09-25T10:00:00Z",
  updated_at: "2026-09-25T10:00:00Z",
};

const TYPED = {
  name: "",
  vat_id: "DE123456789",
  country: "TR",
  address: "Some street 1",
  email: "wrong",
  phone: "+90 212 000",
  customer_class: "new",
  preferred_locale: "en",
  notes: "Met at the fair.",
};

describe("createCustomer", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    revalidatePath.mockClear();
    redirect.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("echoes every submitted value with the field errors (no Supabase call)", async () => {
    getCurrentUser.mockResolvedValue(session("sales"));
    const state = await createCustomer(INITIAL_CUSTOMER_FORM_STATE, form(TYPED));
    expect(state.status).toBe("error");
    expect(state.fieldErrors).toEqual({ name: "required", email: "invalidEmail" });
    expect(state.values).toEqual(TYPED);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("echoes the values when the role may not write", async () => {
    getCurrentUser.mockResolvedValue(session("viewer"));
    const state = await createCustomer(INITIAL_CUSTOMER_FORM_STATE, form(TYPED));
    expect(state).toEqual({ status: "error", error: "forbidden", values: TYPED });
  });

  it("echoes the values when the insert fails", async () => {
    getCurrentUser.mockResolvedValue(session("sales"));
    createClient.mockResolvedValue(
      stubClient({ single: { data: null, error: { message: "boom" } } })
    );
    const valid = { ...TYPED, name: "Acme", email: "buyer@acme.de" };
    const state = await createCustomer(INITIAL_CUSTOMER_FORM_STATE, form(valid));
    expect(state).toEqual({ status: "error", error: "generic", values: valid });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("accepts a country outside the curated list, audits and redirects", async () => {
    getCurrentUser.mockResolvedValue(session("sales"));
    const client = stubClient({ single: { data: { ...ROW, country: "TR" }, error: null } });
    createClient.mockResolvedValue(client);
    const valid = { ...TYPED, name: "Acme", email: "Buyer@Acme.DE" };
    await expect(
      createCustomer(INITIAL_CUSTOMER_FORM_STATE, form(valid))
    ).rejects.toThrow(`NEXT_REDIRECT:/customers/${ID}?created=1`);
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({ country: "TR", email: "buyer@acme.de", created_by: "user-1" })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "customer.create" }));
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe("updateCustomer", () => {
  beforeEach(() => {
    createClient.mockReset();
    getCurrentUser.mockReset();
    logAudit.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("echoes the values with the field errors", async () => {
    getCurrentUser.mockResolvedValue(session("admin"));
    const state = await updateCustomer(ID, INITIAL_CUSTOMER_FORM_STATE, form(TYPED));
    expect(state.status).toBe("error");
    expect(state.fieldErrors).toEqual({ name: "required", email: "invalidEmail" });
    expect(state.values).toEqual(TYPED);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("echoes the values when the customer no longer exists", async () => {
    getCurrentUser.mockResolvedValue(session("sales"));
    createClient.mockResolvedValue(stubClient({ maybeSingle: { data: null, error: null } }));
    const valid = { ...TYPED, name: "Acme", email: "" };
    const state = await updateCustomer(ID, INITIAL_CUSTOMER_FORM_STATE, form(valid));
    expect(state).toEqual({ status: "error", error: "notFound", values: valid });
  });

  it("returns the saved row (and no stale values) on success", async () => {
    getCurrentUser.mockResolvedValue(session("sales"));
    const after = { ...ROW, name: "Acme", country: "GR" };
    createClient.mockResolvedValue(
      stubClient({
        maybeSingle: { data: ROW, error: null },
        single: { data: after, error: null },
      })
    );
    const valid = { ...TYPED, name: "Acme", email: "", country: "GR" };
    const state = await updateCustomer(ID, INITIAL_CUSTOMER_FORM_STATE, form(valid));
    expect(state).toEqual({ status: "saved", customer: after });
    expect(state).not.toHaveProperty("values");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.update", entityId: ID })
    );
  });
});
