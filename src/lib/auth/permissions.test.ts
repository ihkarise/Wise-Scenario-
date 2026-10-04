import { describe, expect, it } from "vitest";
import { actorFromGuestCookie, can, guestActor, type Actor } from "./actor";

const user = (roles: Actor["roles"]): Actor => ({ id: "u", kind: "user", roles });

describe("authorization", () => {
  it("guests and learners can play but cannot reach admin functionality", () => {
    for (const actor of [guestActor("11111111-1111-4111-8111-111111111111"), user(["LEARNER"])]) {
      expect(can(actor, "case:play")).toBe(true);
      for (const p of ["admin:access", "case:edit", "case:read_draft", "case:publish", "user:manage"] as const) {
        expect(can(actor, p)).toBe(false);
      }
    }
  });

  it("only SUPER_ADMIN can publish (Milestone 1 decision)", () => {
    expect(can(user(["SUPER_ADMIN"]), "case:publish")).toBe(true);
    for (const role of ["ADMIN", "EDITOR", "REVIEWER", "LEARNER"] as const) {
      expect(can(user([role]), "case:publish")).toBe(false);
    }
  });

  it("reviewers can review but not edit; editors can edit but not review", () => {
    expect(can(user(["REVIEWER"]), "case:review")).toBe(true);
    expect(can(user(["REVIEWER"]), "case:edit")).toBe(false);
    expect(can(user(["EDITOR"]), "case:edit")).toBe(true);
    expect(can(user(["EDITOR"]), "case:review")).toBe(false);
  });

  it("no actor means no permissions, and malformed guest cookies are ignored", () => {
    expect(can(null, "case:play")).toBe(false);
    expect(actorFromGuestCookie("admin")).toBeNull();
    expect(actorFromGuestCookie("' OR 1=1 --")).toBeNull();
    expect(actorFromGuestCookie(undefined)).toBeNull();
    expect(actorFromGuestCookie("11111111-1111-4111-8111-111111111111")?.roles).toEqual(["LEARNER"]);
  });
});
