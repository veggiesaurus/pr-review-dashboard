// A whole word of identifier characters, so the query can never be read as an option or a pattern.
export const USAGE_QUERY = /^[A-Za-z_$][\w$.]{1,79}$/;
