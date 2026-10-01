function validDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

function businessTimeZone() {
  const zone = process.env.ASSET_TIME_ZONE || 'Asia/Kolkata'
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date())
  } catch {
    throw new Error(`ASSET_TIME_ZONE is not a valid IANA time zone: ${zone}`)
  }
  return zone
}

function businessToday() {
  const fixed = process.env.ASSET_FIXED_TODAY
  if (fixed) {
    if (!validDateString(fixed)) throw new Error('ASSET_FIXED_TODAY must use a valid YYYY-MM-DD date')
    return fixed
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone(),
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date())
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

module.exports = { businessToday, businessTimeZone }
