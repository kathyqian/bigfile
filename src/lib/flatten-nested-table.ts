import { quoteIdent } from "@/lib/data-query";

type Conn = {
  query: (sql: string) => Promise<import("apache-arrow").Table>;
};

type ColInfo = { name: string; type: string };

function isStructType(duckdbType: string): boolean {
  return /^\s*STRUCT\s*\(/i.test(duckdbType);
}

function isListType(duckdbType: string): boolean {
  const t = duckdbType.trim();
  return (
    /^\s*LIST\s*\(/i.test(t) ||
    /^\s*ARRAY\s*\(/i.test(t) ||
    /\w\s*\[\s*\]\s*$/i.test(t)
  );
}

function isMapType(duckdbType: string): boolean {
  return /^\s*MAP\s*\(/i.test(duckdbType);
}

function isNestedType(duckdbType: string): boolean {
  return (
    isStructType(duckdbType) ||
    isListType(duckdbType) ||
    isMapType(duckdbType) ||
    /^\s*UNION\s*\(/i.test(duckdbType)
  );
}

async function tableColumns(conn: Conn, tableName: string): Promise<ColInfo[]> {
  const safe = tableName.replace(/'/g, "''");
  const ti = await conn.query(
    `SELECT name, type FROM pragma_table_info('${safe}') ORDER BY cid;`,
  );
  const nameCol = ti.getChild("name");
  const typeCol = ti.getChild("type");
  const out: ColInfo[] = [];
  for (let i = 0; i < ti.numRows; i++) {
    out.push({
      name: String(nameCol?.get(i) ?? ""),
      type: String(typeCol?.get(i) ?? ""),
    });
  }
  return out;
}

/**
 * Expand STRUCT columns into leaf fields and stringify LIST/MAP/UNION so the
 * grid sees a flat tabular schema. No-op when nothing is nested.
 */
export async function flattenNestedTable(
  conn: Conn,
  tableName: string,
): Promise<boolean> {
  const cols = await tableColumns(conn, tableName);
  if (!cols.some((c) => isNestedType(c.type))) return false;

  const selectParts: string[] = [];
  for (const col of cols) {
    const q = quoteIdent(col.name);
    if (isStructType(col.type)) {
      // keep_parent_names → "parent.child" aliases when supported
      selectParts.push(
        `unnest(${q}, recursive := true, keep_parent_names := true)`,
      );
    } else if (
      isListType(col.type) ||
      isMapType(col.type) ||
      /^\s*UNION\s*\(/i.test(col.type)
    ) {
      selectParts.push(`to_json(${q}) AS ${q}`);
    } else {
      selectParts.push(q);
    }
  }

  const t = quoteIdent(tableName);
  const staging = quoteIdent(`_bf_flat_${tableName}`.slice(0, 63));

  try {
    await conn.query(`DROP TABLE IF EXISTS ${staging};`);
    await conn.query(`
      CREATE TABLE ${staging} AS
      SELECT ${selectParts.join(", ")}
      FROM ${t};
    `);
  } catch {
    // Older DuckDB builds may lack keep_parent_names — retry without it.
    const fallbackParts: string[] = [];
    for (const col of cols) {
      const q = quoteIdent(col.name);
      if (isStructType(col.type)) {
        fallbackParts.push(`unnest(${q}, recursive := true)`);
      } else if (
        isListType(col.type) ||
        isMapType(col.type) ||
        /^\s*UNION\s*\(/i.test(col.type)
      ) {
        fallbackParts.push(`to_json(${q}) AS ${q}`);
      } else {
        fallbackParts.push(q);
      }
    }
    await conn.query(`DROP TABLE IF EXISTS ${staging};`);
    await conn.query(`
      CREATE TABLE ${staging} AS
      SELECT ${fallbackParts.join(", ")}
      FROM ${t};
    `);
  }

  await conn.query(`DROP TABLE ${t};`);
  await conn.query(`ALTER TABLE ${staging} RENAME TO ${t};`);

  // Second pass: nested lists-inside-structs may remain as LIST after unnest.
  const after = await tableColumns(conn, tableName);
  if (after.some((c) => isNestedType(c.type))) {
    const stringifyParts = after.map((col) => {
      const q = quoteIdent(col.name);
      if (isNestedType(col.type)) return `to_json(${q}) AS ${q}`;
      return q;
    });
    const staging2 = quoteIdent(`_bf_flat2_${tableName}`.slice(0, 63));
    await conn.query(`DROP TABLE IF EXISTS ${staging2};`);
    await conn.query(`
      CREATE TABLE ${staging2} AS
      SELECT ${stringifyParts.join(", ")}
      FROM ${t};
    `);
    await conn.query(`DROP TABLE ${t};`);
    await conn.query(`ALTER TABLE ${staging2} RENAME TO ${t};`);
  }

  return true;
}
