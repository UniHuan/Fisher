import request from "supertest";
import { createTestApp } from "./create-test-app";

describe("API bootstrap", () => {
  it("serves health and wraps 404", async () => {
    const app = await createTestApp();
    await request(app.getHttpServer()).get("/health").expect(200, { status: "ok" });

    const res = await request(app.getHttpServer())
      .get("/api/v1/missing")
      .set("X-Client-Type", "miniprogram")
      .set("X-Client-Version", "1.0.0")
      .expect(404);
    expect(res.body.code).toBe(40401);
    expect(res.body.request_id).toMatch(/^req_/);
    expect(res.headers["x-request-id"]).toBe(res.body.request_id);
    await app.close();
  });

  it("rejects invalid X-Client-Type", async () => {
    const app = await createTestApp();
    const res = await request(app.getHttpServer())
      .get("/api/v1/missing")
      .set("X-Client-Type", "bot")
      .set("X-Client-Version", "1.0.0")
      .expect(400);
    expect(res.body.code).toBe(40001);
    await app.close();
  });
});
