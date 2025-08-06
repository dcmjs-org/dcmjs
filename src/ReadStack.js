
/**
 * A read stack holds the state for the current parsing of DICOM data.
 * This allows a single method to handle the parsing for DICOM in a non-recursive
 * fashion by modifying the read stack, which allows a re-entrant parser to
 * be written that remembers the already parsed data.
 */
export class ReadStack {
   parentStack: ReadStack;
   rootStack: ReadStack;

   currentData;

   parseNext;
   
}