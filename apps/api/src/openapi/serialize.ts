/** Stable text form of the description, so the committed file only changes when the API does. */
export const stringifyOpenApi = (doc: unknown) => JSON.stringify(doc, null, 2) + '\n';
