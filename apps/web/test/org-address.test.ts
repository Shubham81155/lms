import { describe, it, expect } from "vitest";
import { displayAddress, guessOrgUrl, isOrgSlug, orgLoginUrl, suggestSlug } from "../src/lib/org-address";

describe("organisation web address", () => {
  it("accepts 3 to 40 lowercase letters, digits and hyphens, not at either end", () => {
    for (const ok of ["abc", "st-marys", "mit", "a1b", "x".repeat(40)]) expect(isOrgSlug(ok), ok).toBe(true);
    for (const bad of ["", "ab", "-abc", "abc-", "ABC", "a b c", "a_b", "x".repeat(41), "é-cole", null, undefined]) expect(isOrgSlug(bad as string), String(bad)).toBe(false);
  });

  it("suggests an address from the organisation's name", () => {
    expect(suggestSlug("St. Mary's College")).toBe("st-marys-college");
    expect(suggestSlug("  École Polytechnique  ")).toBe("ecole-polytechnique");
    expect(suggestSlug("IIT (Delhi) — Campus #2")).toBe("iit-delhi-campus-2");
    expect(suggestSlug("A".repeat(39) + " b")).toBe("a".repeat(39));
    expect(suggestSlug("!!!")).toBe("");
  });

  it("guesses the subdomain address on the current host", () => {
    expect(guessOrgUrl("st-marys", "http://localhost:3000")).toBe("http://st-marys.localhost:3000");
    expect(guessOrgUrl("st-marys", "https://lms.example.com")).toBe("https://st-marys.lms.example.com");
    expect(guessOrgUrl("Bad Slug", "http://localhost:3000")).toBeNull();
    expect(guessOrgUrl("st-marys", "not a url")).toBeNull();
  });

  it("sends sign-in to the organisation's own address, and only over http(s)", () => {
    expect(orgLoginUrl("http://harvard.localhost:3000")).toBe("http://harvard.localhost:3000/login");
    expect(orgLoginUrl("https://learn.uni.edu/some/path")).toBe("https://learn.uni.edu/login");
    expect(orgLoginUrl("javascript:alert(1)")).toBe("/login");
    expect(orgLoginUrl(undefined)).toBe("/login");
    expect(orgLoginUrl("nonsense")).toBe("/login");
  });

  it("shows an address without the scheme", () => {
    expect(displayAddress("https://st-marys.example.com")).toBe("st-marys.example.com");
    expect(displayAddress("http://harvard.localhost:3000")).toBe("harvard.localhost:3000");
  });
});
