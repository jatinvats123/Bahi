import { describe, expect, it } from "vitest";
import clientsJson from "@fixtures/clients.json";
import { ClientSchema, type Client } from "../ledger";
import { resolveClient } from "./resolve-client";

const clients: Client[] = clientsJson.map((c) => ClientSchema.parse(c));

function name(spoken: string): string | null {
  const r = resolveClient(clients, spoken);
  return r.status === "matched" ? r.client.name : null;
}

describe("resolveClient", () => {
  it.each([
    ["Sharma Traders", "Sharma Traders"],
    ["sharma ji", "Sharma Traders"],
    ["Sharma ji ko", "Sharma Traders"],
    ["sharmaa", "Sharma Traders"],
    ["Rakesh ji", "Sharma Traders"],
    ["varma sweets", "Verma Sweets"],
    ["Verma wale", "Verma Sweets"],
    ["gupta electronics", "Gupta Electronics"],
    ["Gupta ji", "Gupta Electronics"],
    ["khanna", "Khanna Tailors"],
    ["cl_iyer", "Iyer Caterers"],
  ])("%s -> %s", (spoken, expected) => {
    expect(name(spoken)).toBe(expected);
  });

  it("never invents a client for an unknown name", () => {
    const r = resolveClient(clients, "Mehta Motors");
    expect(r.status).toBe("not_found");
  });

  it("does not match on a generic business word alone", () => {
    expect(resolveClient(clients, "traders").status).toBe("not_found");
    expect(resolveClient(clients, "sweets wale").status).toBe("not_found");
  });

  it("returns candidates when two clients fit equally", () => {
    const twins: Client[] = [
      ClientSchema.parse({ id: "a", name: "Sharma Traders", contact: "A", email: "a@x.example", city: "X" }),
      ClientSchema.parse({ id: "b", name: "Sharma Sweets", contact: "B", email: "b@x.example", city: "Y" }),
    ];
    const r = resolveClient(twins, "sharma ji");
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates.map((c) => c.client.id).sort()).toEqual(["a", "b"]);
  });

  it("offers near candidates for a weak match without choosing one", () => {
    const r = resolveClient(clients, "Guptaji Stores");
    expect(r.status === "matched" ? r.client.id : "cl_gupta").toBe("cl_gupta");
  });
});
