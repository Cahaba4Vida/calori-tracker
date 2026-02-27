function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

function getDenverDateISO(now = new Date()) {
  // Returns YYYY-MM-DD in America/Denver.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(now); // en-CA yields YYYY-MM-DD
}

// Safe JSON body reader for Netlify Functions.
// Returns {} if body is empty or invalid JSON.
function readJson(event) {
  try {
    if (!event || !event.body) return {};
    if (typeof event.body !== "string") return event.body || {};
    return JSON.parse(event.body || "{}");
  } catch (e) {
    return {};
  }
}

module.exports = { json, getDenverDateISO, readJson };
