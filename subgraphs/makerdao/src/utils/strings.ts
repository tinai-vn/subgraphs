import { ethereum } from "@graphprotocol/graph-ts";

export function createEventID(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

/**
 * Get the ISO 8601 Date string (in UTC time zone) of a Date object.
 *
 * @param date Date object
 * @returns string representation of ISO 8601 Date string (YYYY-MM-DD) in UTC
 * time zone
 */
 export function getISODateStringInUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  let monthStr = `${month}`;
  if (month < 10) {
    monthStr = `0${month}`;
  }
  const day = date.getUTCDate();
  let dayStr = `${day}`;
  if (day < 10) {
    dayStr = `0${day}`;
  }
  return `${year}-${monthStr}-${dayStr}`;
}

/**
 * Get the ISO 8601 Date string (in UTC time zone) of a Date object.
 *
 * @param date Date object
 * @returns string representation of ISO 8601 Date string (YYYY-MM-DD) in UTC
 * time zone
 */
 export function getISODateTimeStartOfDayStringInUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  let monthStr = `${month}`;
  if (month < 10) {
    monthStr = `0${month}`;
  }
  const day = date.getUTCDate();
  let dayStr = `${day}`;
  if (day < 10) {
    dayStr = `0${day}`;
  }
  return `${year}-${monthStr}-${dayStr}T00:00:00.000Z`;
}

/**
 * Get the Date object of a date X days in the future. The result always has
 * T00:00:00.000Z (the beginning of the UTC date).
 *
 * Example: If date = 2022-08-05T20:00:00-08:00, numDaysAhead = 2, the result is
 * 2022-08-08T00:00:00Z.
 *
 * Reference: https://bobbyhadz.com/blog/javascript-get-date-x-days-ago
 *
 * @param numDaysAhead The number of days to go forward
 * @param date The reference date object. Default: The Date object of the
 * current moment
 * @returns Date object
 */
 export function getDateXDaysAheadInUTC(numDaysAhead: i32, date: Date = new Date()): Date {
  const result = new Date(date.getTime()); // Date object is local
  result.setUTCDate(date.getUTCDate() + numDaysAhead);
  result.setUTCHours(0);
  result.setUTCMinutes(0);
  result.setUTCSeconds(0);
  result.setUTCMilliseconds(0);
  return result;
}
