/** Max rows returned for SELECT / WITH queries (outer LIMIT). */
export const QUERY_RESULT_ROW_LIMIT = 1000;

function stripLeadingNoise(s: string): string {
  let t = s.trimStart();
  while (true) {
    if (t.startsWith("--")) {
      const nl = t.indexOf("\n");
      if (nl === -1) return "";
      t = t.slice(nl + 1).trimStart();
      continue;
    }
    if (t.startsWith("/*")) {
      const end = t.indexOf("*/");
      if (end === -1) return "";
      t = t.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  return t;
}

function firstKeyword(working: string): string | null {
  const m = working.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Validates read-only SQL and applies a row cap to SELECT / WITH via a subquery wrapper.
 * DESCRIBE, SHOW, and EXPLAIN are passed through unchanged.
 */
export function prepareReadOnlyQuery(
  sql: string,
): { sql: string } | { error: string } {
  const trimmed = sql.trim();
  if (!trimmed) return { error: "Query is empty." };

  let stmt = trimmed.replace(/;+\s*$/g, "");
  if (stmt.includes(";")) {
    return { error: "Multiple statements are not allowed." };
  }

  const head = stripLeadingNoise(stmt);
  if (!head) return { error: "Query is empty." };

  const kw = firstKeyword(head);
  if (!kw) return { error: "Invalid query." };

  if (
    kw === "INSERT" ||
    kw === "UPDATE" ||
    kw === "DELETE" ||
    kw === "MERGE" ||
    kw === "CREATE" ||
    kw === "DROP" ||
    kw === "ALTER" ||
    kw === "TRUNCATE" ||
    kw === "COPY" ||
    kw === "ATTACH" ||
    kw === "DETACH" ||
    kw === "EXPORT" ||
    kw === "IMPORT" ||
    kw === "LOAD" ||
    kw === "PRAGMA" ||
    kw === "CALL"
  ) {
    return {
      error: `Statement type "${kw}" is not allowed. Use SELECT, WITH, DESCRIBE, SHOW, or EXPLAIN.`,
    };
  }

  if (kw === "DESCRIBE" || kw === "SHOW" || kw === "EXPLAIN") {
    return { sql: stmt };
  }

  if (kw === "WITH" || kw === "SELECT") {
    return {
      sql: `SELECT * FROM (${stmt}) AS _bf_sub LIMIT ${QUERY_RESULT_ROW_LIMIT}`,
    };
  }

  return {
    error:
      "Only SELECT, WITH, DESCRIBE, SHOW, and EXPLAIN queries are allowed.",
  };
}
