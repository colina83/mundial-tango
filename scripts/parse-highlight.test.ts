import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePdfFile } from "./parse-pdf.ts";
import { buildDataset } from "./year-io.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("pista cuartos A highlights Pérez/Cantarini from the PDF row fill", async () => {
  const pdf = join(
    ROOT,
    "data/raw/cuartos/Jurados-_-Pista-Cuartos-2026-27_8-A-Copia-de-JURADOS-_-RONDAS-TODAS-278-A.pdf",
  );
  const block = await parsePdfFile(pdf, {
    year: 2026,
    stage: "cuartos",
    scoring: "trimmed",
    category: "pista",
  });
  assert.equal(block.highlightsDetected, true);
  const cantarini = block.couples.find((c) => c.coupleId === 452);
  assert.ok(cantarini, "couple 452 should parse");
  assert.equal(cantarini!.dancer2.includes("Cantarini"), true);
  assert.equal(cantarini!.highlighted, true);
  const highlighted = block.couples.filter((c) => c.highlighted);
  assert.ok(highlighted.length > 0);
  assert.ok(highlighted.length < block.couples.length);
  assert.equal(highlighted.length, 75);

  const dataset = buildDataset(
    "cuartos",
    "https://tangoba.org/",
    "https://tangoba.org/category/resultados/",
    [block],
    2026,
    "trimmed",
    "pista",
  );
  const row = dataset.rows.find((r) => r.coupleId === 452);
  assert.equal(row?.classified, true);
  assert.equal(dataset.blocks[0]!.classifiedCount, highlighted.length);
  assert.equal(dataset.rows.filter((r) => r.classified).length, highlighted.length);
});

test("escenario clasificatoria A classified count comes from rosa highlight not 50%", async () => {
  const pdf = join(
    ROOT,
    "data/raw/escenario/clasificatoria/Jurados-_-Escenario-Clasificatorias-2026-25_8-A-Copia-de-JURADOS-_-RONDAS-TODAS-258-A.pdf",
  );
  const block = await parsePdfFile(pdf, {
    year: 2026,
    stage: "clasificatoria",
    scoring: "trimmed",
    category: "escenario",
  });
  assert.equal(block.highlightsDetected, true);
  const highlighted = block.couples.filter((c) => c.highlighted).length;
  assert.equal(highlighted, 19);
  const dataset = buildDataset(
    "clasificatoria",
    "https://tangoba.org/",
    "https://tangoba.org/category/resultados/",
    [block],
    2026,
    "trimmed",
    "escenario",
  );
  assert.equal(dataset.blocks[0]!.classifiedCount, 19);
  assert.equal(dataset.rows.filter((r) => r.classified).length, 19);
});

test("pista cuartos B uses PDF highlights and does not classify the whole field", async () => {
  const pdf = join(
    ROOT,
    "data/raw/cuartos/Jurados-_-Pista-Cuartos-2026-27_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-278-B.pdf",
  );
  const block = await parsePdfFile(pdf, {
    year: 2026,
    stage: "cuartos",
    scoring: "trimmed",
    category: "pista",
  });
  assert.equal(block.highlightsDetected, true);
  const highlighted = block.couples.filter((c) => c.highlighted).length;
  assert.ok(highlighted > 0);
  assert.ok(highlighted < block.couples.length);
  const dataset = buildDataset(
    "cuartos",
    "https://tangoba.org/",
    "https://tangoba.org/category/resultados/",
    [block],
    2026,
    "trimmed",
    "pista",
  );
  assert.equal(dataset.blocks[0]!.classifiedCount, highlighted);
});

test("pista semifinal highlights Pérez/Cantarini as the last couple in", async () => {
  const pdf = join(
    ROOT,
    "data/raw/semifinal/Jurados-_-Pista-Semifinales-2026-29_8-Copia-de-JURADOS-_-RONDAS-TODAS-298.pdf",
  );
  const block = await parsePdfFile(pdf, {
    year: 2026,
    stage: "semifinal",
    scoring: "trimmed",
    category: "pista",
  });
  assert.equal(block.highlightsDetected, true);
  const cantarini = block.couples.find((c) => c.coupleId === 452);
  assert.ok(cantarini);
  assert.equal(cantarini!.highlighted, true);
  const highlighted = block.couples.filter((c) => c.highlighted);
  assert.equal(highlighted.length, 36);
  const lastAvg = Math.min(...highlighted.map((c) => c.average));
  assert.equal(cantarini!.average, lastAvg);
  const dataset = buildDataset(
    "semifinal",
    "https://tangoba.org/",
    "https://tangoba.org/category/resultados/",
    [block],
    2026,
    "trimmed",
    "pista",
  );
  const row = dataset.rows.find((r) => r.coupleId === 452);
  assert.equal(row?.classified, true);
  assert.equal(dataset.blocks[0]!.classifiedCount, 36);
  assert.equal(dataset.blocks[0]!.cutoff, 8.355);
  assert.notEqual(highlighted.length, Math.ceil(block.couples.length / 2));
});

test("escenario cuartos uses PDF highlights, not half the field", async () => {
  const files = [
    ["Jurados-_-Escenario-Cuartos-2026-28_8-A-Copia-de-JURADOS-_-RONDAS-TODAS-288-A.pdf", 20],
    ["Jurados-_-Escenario-Cuartos-2026-27_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-288-B.pdf", 20],
  ] as const;
  for (const [name, expected] of files) {
    const block = await parsePdfFile(join(ROOT, "data/raw/escenario/cuartos", name), {
      year: 2026,
      stage: "cuartos",
      scoring: "trimmed",
      category: "escenario",
    });
    assert.equal(block.highlightsDetected, true, name);
    const highlighted = block.couples.filter((c) => c.highlighted).length;
    assert.equal(highlighted, expected, name);
    assert.ok(highlighted < block.couples.length, name);
    const dataset = buildDataset(
      "cuartos",
      "https://tangoba.org/",
      "https://tangoba.org/category/resultados/",
      [block],
      2026,
      "trimmed",
      "escenario",
    );
    assert.equal(dataset.blocks[0]!.classifiedCount, expected, name);
  }
});

test("remaining escenario clasificatoria sheets detect row highlights", async () => {
  const files = [
    "Jurados-_-Escenario-Clasificatorias-2026-25_8-B-Copia-de-JURADOS-_-RONDAS-TODAS-258-B.pdf",
    "Jurados-_-Escenario-Clasificatorias-2026-26_8-C-Copia-de-JURADOS-_-RONDAS-TODAS-268-C.pdf",
    "Jurados-_-Escenario-Clasificatorias-2026-26_8-D-Copia-de-JURADOS-_-RONDAS-TODAS-268-D-1.pdf",
  ];
  for (const name of files) {
    const block = await parsePdfFile(join(ROOT, "data/raw/escenario/clasificatoria", name), {
      year: 2026,
      stage: "clasificatoria",
      scoring: "trimmed",
      category: "escenario",
    });
    assert.equal(block.highlightsDetected, true, name);
    const n = block.couples.filter((c) => c.highlighted).length;
    assert.ok(n > 0 && n < block.couples.length, `${name} highlighted=${n} of ${block.couples.length}`);
  }
});
