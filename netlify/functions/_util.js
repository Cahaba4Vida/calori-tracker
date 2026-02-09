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

module.exports = { json, getDenverDateISO };
