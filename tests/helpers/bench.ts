// The template with mistakes of the agent benchmark (bench/agents/files/broken.docx), built in code
// because the repository holds no Office files.
import { buildDocx, p } from './docx';

/** A Word template with an unclosed tag, an unclosed loop and a formatter without its argument. */
export const brokenDocx = (): Uint8Array => buildDocx({ body: p('Dear {customer.name,') + p('{#items}{name}') + p('Total: {total | currency}') });
