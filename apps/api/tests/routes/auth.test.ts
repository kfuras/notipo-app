import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const required = ["DATABASE_URL", "ENCRYPTION_KEY", "API_KEY"];
const missing = required.filter((k) => !process.env[k]);

const describeDb = missing.length > 0 ? describe.skip : describe;

let app: FastifyInstance;

describeDb("auth routes", () => {
  beforeAll(async () => {
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/auth/providers", () => {
    it("returns available auth methods", async () => {
      const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.password).toBe(true);
      expect(typeof body.data.signup).toBe("boolean");
    });
  });

  describe("POST /api/auth/register", () => {
    const unique = `test-${Date.now()}`;

    it("creates a new tenant and user", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `${unique}@test.com`,
          password: "testpassword123",
          blogName: `Test Blog ${unique}`,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.apiKey).toBeTruthy();
      expect(body.data.apiKey).toHaveLength(64);
      expect(body.data.user.email).toBe(`${unique}@test.com`);
      expect(body.data.tenant.name).toBe(`Test Blog ${unique}`);
      expect(body.data.tenant.slug).toBeTruthy();
    });

    it("rejects duplicate email registration", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `${unique}@test.com`,
          password: "anotherpassword",
          blogName: "Another Blog",
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it("rejects short passwords", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `short-${unique}@test.com`,
          password: "abc",
          blogName: "Short Pass Blog",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid email", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "not-an-email",
          password: "testpassword123",
          blogName: "Bad Email Blog",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects missing blogName", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `missing-${unique}@test.com`,
          password: "testpassword123",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    const unique = `login-${Date.now()}`;
    let registeredApiKey: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `${unique}@test.com`,
          password: "mypassword123",
          blogName: `Login Test ${unique}`,
        },
      });
      registeredApiKey = res.json().data.apiKey;
    });

    it("returns API key for valid credentials", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: `${unique}@test.com`,
          password: "mypassword123",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.apiKey).toBe(registeredApiKey);
      expect(body.data.user.email).toBe(`${unique}@test.com`);
      expect(body.data.tenant).toBeTruthy();
    });

    it("rejects wrong password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: `${unique}@test.com`,
          password: "wrongpassword",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects non-existent email", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "nonexistent@test.com",
          password: "somepassword",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns same generic error for wrong email and wrong password", async () => {
      const [wrongEmail, wrongPass] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: "fake@test.com", password: "x" },
        }),
        app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: `${unique}@test.com`, password: "wrong" },
        }),
      ]);
      expect(wrongEmail.json().message).toBe(wrongPass.json().message);
    });

    it("API key from login works for authenticated routes", async () => {
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: `${unique}@test.com`,
          password: "mypassword123",
        },
      });
      const apiKey = loginRes.json().data.apiKey;

      const settingsRes = await app.inject({
        method: "GET",
        url: "/api/settings",
        headers: { "x-api-key": apiKey },
      });
      expect(settingsRes.statusCode).toBe(200);
    });
  });

  describe("auth routes are public", () => {
    it("does not require API key for /api/auth/providers", async () => {
      const res = await app.inject({ method: "GET", url: "/api/auth/providers" });
      expect(res.statusCode).toBe(200);
    });

    it("does not require API key for /api/auth/login", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "any@test.com", password: "any" },
      });
      // Should be 401 (invalid creds), not 401 (missing API key)
      expect(res.statusCode).toBe(401);
      expect(res.json().message).not.toContain("x-api-key");
    });
  });
});
