# Writing style guide

This guide covers prose written for people: pull request descriptions,
README sections, documentation pages, changelog entries, and comments that
explain a decision. It exists because reviewers asked for it directly. The
1.0 review stalled partly on language, not code.

Parts of the "patterns to avoid" section are adapted from Cursor's
[unslop skill](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md),
which catalogs the tells of machine-generated prose.

## Who you are writing for

Write for a motivated, intelligent reader who probably works in healthcare
and found this library for a reason: a hospital integration, a research
project, a patient trying to read their own CD of images. Assume real
interest and real intelligence. Do not assume knowledge of programming,
radiology, imaging physics, or the DICOM standard.

The test: if understanding your paragraph requires already knowing what a
transfer syntax or a VR is, the paragraph fails. Either define the term or
remove it.

## Jargon: define on first use, with one good metaphor

Terms of art are allowed, since this is a technical project, but each one
gets a plain-language definition the first time it appears in a document.
A concrete metaphor helps more than a formal definition. Examples:

-   A **transfer syntax** is the file's packing instructions: the same
    clothes fold differently into different suitcases, and the label on the
    suitcase tells you how to unpack it.
-   A **DICOMDIR** is the table of contents on the CD a patient receives:
    it lists which studies, series, and images are on the disc and where.
-   **Streaming** means reading a file the way you read a book, one page at
    a time, instead of photocopying the whole book before reading page one.

Pick one metaphor per concept and stay with it for the whole document.
Switching metaphors mid-explanation makes the reader re-learn.

A boundary worth stating: metaphors are for teaching, not decoration. A
metaphor that gives a newcomer a concept they did not have is doing work.
A metaphor draped over a technical statement the reader already understands
("the plan holds it", "the writer rides along on the stream") is
decoration; say the literal thing. If removing the metaphor loses
information for a newcomer, keep it. If removing it changes nothing but
tone, remove it.

Spending a few extra sentences on a well-chosen explanation is preferred
over being ultra-concise. Concision that costs comprehension is not
concision; it just moves the cost to the reader.

## Patterns to avoid

These constructions read as machine-generated filler and are not welcome
in this repository's prose.

### Words and phrases

-   AI vocabulary: _additionally_, _crucial_, _cutting-edge_, _delve_,
    _dive into_, _enduring_, _enhance_, _fostering_, _game-changer_,
    _garner_, _interplay_, _intricate_, _landscape_ (abstract), _pivotal_,
    _robust_, _seamless_, _showcase_, _tapestry_ (abstract), _testament_,
    _underscore_, _vibrant_. Use the plain word.
-   Fancy synonyms for plain words: _utilize_ means use, _leverage_ means
    use, _facilitate_ means help, _numerous_ means many, "in the event
    that" means if. The fancier synonym is rarely clearer.
-   Fancy ways to say "is": "serves as", "stands as", "boasts",
    "features". Just say "is" or "has".
-   Filler phrases: "in order to" becomes "to". "Due to the fact that"
    becomes "because". "It is important to note that" gets deleted.
-   Vague attributions: "experts believe", "industry reports suggest",
    "some argue". Name the source or delete the claim.
-   Superficial trailing "-ing" phrases: "...ensuring reliability",
    "...highlighting the importance of standards". Delete them, or replace
    them with a specific fact.

### Constructions

-   The frame "It's not just X, it's Y" and its cousins ("This isn't
    about X"; "X isn't merely Y"). State the point directly.
-   Forcing ideas into groups of three. Use however many there really are.
-   False ranges: "from X to Y" where X and Y are not points on a real
    scale. List the items directly.
-   Synonym cycling: calling the same thing the parser, the reader, and
    the engine within one page. Pick one name and repeat it.
-   Staccato sentence fragments for emphasis. ("Fast. Simple. Done.")
-   Excessive hedging: "could potentially possibly be argued that it
    might" becomes "may".
-   Generic conclusions: "The future looks bright." State specific plans
    or facts, or end without a conclusion.
-   Chatbot phrases and sycophancy: "I hope this helps!", "Let me know
    if...", "Certainly!", "Great question!". Respond directly.
-   Exclamation points in technical prose.

### Punctuation and formatting

-   Avoid em dashes. If a thought needs separation, end the sentence or
    use a comma.
-   Colons are fine before a list or an example, not as mid-sentence
    connectors gluing two clauses together.
-   Bold sparingly. Do not bold every proper noun or acronym. The bold
    label with a colon that restates its own line ("**Performance:**
    performance improved") converts to prose. A bold lead-in that ends in
    a period, names the item, and is followed by genuinely new detail is
    fine.
-   Headings in sentence case, not Title Case.
-   Straight quotes, not curly quotes.
-   No emoji, decorative or otherwise.

### Jargon dressed as depth

Abstract metaphor nouns read as technical but usually hide a plainer
concrete word: _substrate_, _wedge_, _vector_ (for "way"), _locus_,
_nexus_, _primitive_ (as a noun), _harness_ (as metaphor), _surface_ (as
in "API surface"), _bedrock_, _scaffolding_ (as metaphor), _paradigm_,
_north star_, _flywheel_, _endgame_, _ratchet_, _gold-plating_.
"Substrate" becomes "base". "Wedge in" becomes "add". "Endgame" becomes
"the last phase". Pick the concrete word.

## Plain speech

-   Say what it does, not how it feels. "SQL you can read" and "the
    database stays close at hand" name a feeling. Name the mechanism or a
    number instead: "a column rename fails the build", "parses a 500 MB
    file in 1.2 seconds". If you cannot restate a sentence as a concrete
    instruction, fact, or number, cut it. And if the sentence could appear
    unchanged in another project's documentation, it says nothing about
    this one; cut it.
-   One idea per sentence. If the reader has to backtrack to parse a
    sentence, break it in two or drop clauses.
-   Active voice, with the actor named: "the compiler validates queries",
    not "queries are validated". Passive is fine only when the actor is
    unknown or genuinely does not matter.
-   Cut adverbs, or use a stronger verb or the measured number. "Runs
    quickly" becomes the number. "Significantly improves" becomes the
    measured difference.
-   Do not over-compress. Dropped articles, verbless fragments, arrows,
    and unexplained abbreviations make the reader decode instead of read.
    "Parser rejects bad date → exit 2, no write" becomes "The parser
    rejects a bad date, exits with code 2, and writes nothing." Write
    whole sentences with their articles and verbs, and spell out arrows
    and abbreviations.
-   Write the explanation the way you would say it to a colleague across a
    desk, then delete the throat-clearing from the transcript.

## Before and after

**Before:**

> This PR delves into a robust, seamless streaming architecture for
> large-file ingestion — a game-changer for performance — leveraging an
> event-driven paradigm. It's not just parsing; it's a fundamentally new
> way of thinking about DICOM data.

**After:**

> This change lets dcmjs read a DICOM file one piece at a time instead of
> loading the whole file into memory first. Before, opening a 20 GB video
> file required 20 GB of memory; now it requires about 2 GB, because the
> library only holds the piece it is currently working on. The reading
> code announces each piece as an event, and other code listens for the
> events it cares about, the way a radio broadcasts and receivers tune in.

The second version is longer. It is also the only one of the two that
tells the reader anything.
