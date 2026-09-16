# Writing style guide

This guide covers prose written for people: pull request descriptions,
README sections, documentation pages, changelog entries, and comments that
explain a decision. It exists because reviewers asked for it directly — the
1.0 review stalled partly on language, not code.

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

Terms of art are allowed — this is a technical project — but each one gets
a plain-language definition the first time it appears in a document, and a
concrete metaphor helps more than a formal definition. Examples:

-   A **transfer syntax** is the file's packing instructions: the same
    clothes fold differently into different suitcases, and the label on the
    suitcase tells you how to unpack it.
-   A **DICOMDIR** is the table of contents on the CD a patient receives:
    it lists which studies, series, and images are on the disc and where.
-   **Streaming** means reading a file the way you read a book — one page at
    a time — instead of photocopying the whole book before reading page one.

Pick one metaphor per concept and stay with it for the whole document.
Switching metaphors mid-explanation makes the reader re-learn.

Spending a few extra sentences on a well-chosen explanation is preferred
over being ultra-concise. Concision that costs comprehension is not
concision; it just moves the cost to the reader.

## Banned patterns

These constructions read as machine-generated filler and are not welcome
in this repository's prose:

-   The words _delve_, _dive into_, _landscape_, _robust_, _seamless_,
    _leverage_ (as a verb), _utilize_, _cutting-edge_, _game-changer_.
-   The frame "It's not just X, it's Y" and its cousins ("This isn't about
    X"; "X isn't merely Y").
-   Staccato sentence fragments for emphasis. ("Fast. Simple. Done.")
-   Chains of clauses spliced with em-dashes where ordinary sentences would
    do.
-   Piles of three adjectives or three parallel phrases where one precise
    word would do.
-   Openers like "Certainly!", "Great question!", or "Let's explore".
-   Exclamation points in technical prose.
-   Emoji.

If a sentence would survive in any project's README, it is probably
saying nothing about this one. Delete it.

## Sentence-level guidance

-   One idea per sentence.
-   Active voice: "the parser reads the header," not "the header is read."
-   Prefer verbs to noun-forms of verbs: "we validated the output," not
    "we performed validation of the output."
-   Numbers beat adverbs: "parses a 500 MB file in 1.2 seconds," not
    "blazingly fast."
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
> events it cares about — the way a radio broadcasts and receivers tune
> in.

The second version is longer. It is also the only one of the two that
tells the reader anything.
