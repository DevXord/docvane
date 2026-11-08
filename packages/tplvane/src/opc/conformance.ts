// The namespaces and relationship types tplvane writes into a rendered package, for each of the two
// conformance classes of ECMA-376. A Strict package stays Strict only if what tplvane adds uses the
// Strict names: Part 1 §11.3.10 (the Strict officeDocument relationship), §15.2.14 (the Strict image
// relationship) and the target namespaces of the Strict schemas of Part 1; the Transitional names are
// those of Part 4 §9 (F-025).

/** The names tplvane writes: the relationships namespace of `r:` attributes, DrawingML and relationship types. */
export interface Vocabulary {
  readonly strict: boolean;
  /** The namespace of `r:id` and `r:embed`. */
  readonly r: string;
  /** DrawingML main (`a:`). */
  readonly a: string;
  /** DrawingML pictures (`pic:`), also the `uri` of `a:graphicData` that holds a picture. */
  readonly pic: string;
  /** DrawingML WordprocessingML drawing (`wp:`). */
  readonly wp: string;
  readonly imageRel: string;
  readonly hyperlinkRel: string;
  readonly slideRel: string;
}

const TRANSITIONAL_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STRICT_R = 'http://purl.oclc.org/ooxml/officeDocument/relationships';

/** Transitional names (ECMA-376 Part 4). */
export const TRANSITIONAL: Vocabulary = {
  strict: false,
  r: TRANSITIONAL_R,
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  imageRel: `${TRANSITIONAL_R}/image`,
  hyperlinkRel: `${TRANSITIONAL_R}/hyperlink`,
  slideRel: `${TRANSITIONAL_R}/slide`,
};

/** Strict names (ECMA-376 Part 1). */
export const STRICT: Vocabulary = {
  strict: true,
  r: STRICT_R,
  a: 'http://purl.oclc.org/ooxml/drawingml/main',
  pic: 'http://purl.oclc.org/ooxml/drawingml/picture',
  wp: 'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing',
  imageRel: `${STRICT_R}/image`,
  hyperlinkRel: `${STRICT_R}/hyperlink`,
  slideRel: `${STRICT_R}/slide`,
};

/** The vocabulary of a package, from the type of its officeDocument relationship. */
export function vocabularyOf(officeDocumentType: string): Vocabulary {
  return officeDocumentType.startsWith(`${STRICT_R}/`) ? STRICT : TRANSITIONAL;
}
